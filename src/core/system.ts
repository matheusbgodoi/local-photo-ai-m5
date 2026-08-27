/**
 * Platform probing.
 *
 * Used by `doctor`, by the installer's preflight, and by the benchmark — the
 * memory-pressure numbers in docs/BENCHMARK.md come from here, measured on the
 * machine, never copied from the internet.
 */

import { statfsSync } from "node:fs";
import { arch, platform, totalmem } from "node:os";
import { run } from "./exec.js";

export interface PlatformInfo {
  os: string;
  osVersion: string;
  chip: string;
  cores: number;
  performanceCores: number;
  efficiencyCores: number;
  memoryGB: number;
  appleSilicon: boolean;
}

export interface MemorySnapshot {
  /** macOS "system-wide memory free percentage", 0..100. */
  freePercent: number | null;
  /** Compressed + wired + active, in GB, as a rough "in use" figure. */
  usedGB: number;
  swapUsedMB: number;
  timestamp: number;
}

async function sysctl(key: string): Promise<string | null> {
  const result = await run("sysctl", ["-n", key], { timeoutMs: 5000 });
  return result.code === 0 ? result.stdout.trim() : null;
}

export async function platformInfo(): Promise<PlatformInfo> {
  const [chip, osVersion, cores, pCores, eCores] = await Promise.all([
    sysctl("machdep.cpu.brand_string"),
    run("sw_vers", ["-productVersion"], { timeoutMs: 5000 }).then((r) => r.stdout.trim()),
    sysctl("hw.ncpu"),
    sysctl("hw.perflevel0.logicalcpu"),
    sysctl("hw.perflevel1.logicalcpu"),
  ]);

  const chipName = chip ?? arch();
  return {
    os: platform() === "darwin" ? "macOS" : platform(),
    osVersion: osVersion || "unknown",
    chip: chipName,
    cores: Number(cores ?? 0),
    performanceCores: Number(pCores ?? 0),
    efficiencyCores: Number(eCores ?? 0),
    memoryGB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    appleSilicon: platform() === "darwin" && /^Apple/.test(chipName),
  };
}

export function freeDiskGB(path: string): number {
  try {
    const stats = statfsSync(path);
    return Math.round(((stats.bavail * stats.bsize) / 1024 ** 3) * 10) / 10;
  } catch {
    return -1;
  }
}

export async function memorySnapshot(): Promise<MemorySnapshot> {
  const [pressure, swap, vm] = await Promise.all([
    run("memory_pressure", [], { timeoutMs: 8000 }).catch(() => null),
    sysctl("vm.swapusage"),
    run("vm_stat", [], { timeoutMs: 8000 }).catch(() => null),
  ]);

  let freePercent: number | null = null;
  if (pressure?.stdout) {
    const match = /free percentage:\s*(\d+)%/i.exec(pressure.stdout);
    if (match) freePercent = Number(match[1]);
  }

  let swapUsedMB = 0;
  if (swap) {
    // Locale-dependent: "used = 1024,00M" on pt-BR, "1024.00M" on en-US.
    const match = /used\s*=\s*([\d.,]+)([KMG])/i.exec(swap);
    if (match) {
      const value = Number(match[1]!.replace(",", "."));
      const unit = match[2]!.toUpperCase();
      swapUsedMB = unit === "G" ? value * 1024 : unit === "K" ? value / 1024 : value;
    }
  }

  let usedGB = 0;
  if (vm?.stdout) {
    const pageSize = Number(/page size of (\d+) bytes/.exec(vm.stdout)?.[1] ?? 16384);
    const read = (label: string): number =>
      Number(new RegExp(`${label}:\\s+(\\d+)`).exec(vm.stdout)?.[1] ?? 0);
    const pages = read("Pages active") + read("Pages wired down") + read("Pages occupied by compressor");
    usedGB = Math.round(((pages * pageSize) / 1024 ** 3) * 10) / 10;
  }

  return { freePercent, usedGB, swapUsedMB: Math.round(swapUsedMB * 10) / 10, timestamp: Date.now() };
}

/**
 * Samples memory while `task` runs. Diffusion peaks for a few seconds, so a
 * before/after pair would miss it entirely.
 */
export async function withMemoryWatch<T>(
  task: () => Promise<T>,
  intervalMs = 1500,
): Promise<{ result: T; peak: MemorySnapshot; samples: MemorySnapshot[] }> {
  const samples: MemorySnapshot[] = [];
  let running = true;

  const sampler = (async () => {
    while (running) {
      samples.push(await memorySnapshot());
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();

  try {
    const result = await task();
    running = false;
    await sampler;
    samples.push(await memorySnapshot());

    const peak = samples.reduce(
      (worst, s) => (s.usedGB > worst.usedGB ? s : worst),
      samples[0] ?? { freePercent: null, usedGB: 0, swapUsedMB: 0, timestamp: Date.now() },
    );
    return { result, peak, samples };
  } finally {
    running = false;
  }
}
