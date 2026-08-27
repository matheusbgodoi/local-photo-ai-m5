/**
 * Benchmark harness.
 *
 * It measures what a machine can measure: wall time, cold-start cost, peak
 * memory, swap, file size. It does not pretend to score realism — that
 * judgement is made by looking at the images, and the harness's job is to lay
 * them out so the comparison is fair (same seeds, same scenes, one variable at
 * a time).
 *
 * Scenario coverage follows the brief deliberately: doctors, elderly people,
 * families, men, products, devices and rooms — not eight portraits of the same
 * young woman, which would tell us nothing about this use case.
 */

import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { LocalPhotoService } from "./service.js";
import { DrawThingsBackend } from "./backend/drawthings.js";
import { generator, loadConfig, loadManifest, saveUserConfig, type Config } from "./config.js";
import { installedLoraFile } from "./lora.js";
import { contactSheet } from "./contactsheet.js";
import { ensureDir, repoRoot } from "./paths.js";
import { memorySnapshot, platformInfo, withMemoryWatch, type PlatformInfo } from "./system.js";
import type { PresetName } from "./types.js";

export interface Scenario {
  id: string;
  label: string;
  prompt: string;
  preset: PresetName;
  /** What to look for when judging this frame by eye. */
  lookFor: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "medical",
    label: "Doctor + elderly patient",
    prompt: "médica brasileira de aproximadamente 40 anos conversando naturalmente com paciente idosa brasileira em uma clínica",
    preset: "clinical",
    lookFor: "two distinct faces, age difference readable, hands, no advertising gloss",
  },
  {
    id: "elderly",
    label: "Elderly couple at home",
    prompt: "casal idoso brasileiro em uma sala de estar real de casa",
    preset: "natural",
    lookFor: "age-appropriate skin, real domestic clutter, no waxiness",
  },
  {
    id: "family",
    label: "Family, nobody posing",
    prompt: "família brasileira interagindo na cozinha de casa, sem todos olhando para a câmera",
    preset: "lifestyle",
    lookFor: "plausible group geometry, varied attention, hands and limb counts",
  },
  {
    id: "man",
    label: "Middle-aged man working",
    prompt: "homem brasileiro de meia idade trabalhando em um escritório",
    preset: "professional",
    lookFor: "male face that is not a stock-photo archetype, real office",
  },
  {
    id: "nurse",
    label: "Nurse and patient in hospital",
    prompt: "enfermeiro brasileiro conversando com paciente em um hospital",
    preset: "clinical",
    lookFor: "uniform detail, hospital that looks used rather than staged",
  },
  {
    id: "product",
    label: "Smartphone on a desk",
    prompt: "celular sobre uma mesa de escritório real",
    preset: "product",
    lookFor: "device geometry, screen reflection, contact shadow, no CGI look",
  },
  {
    id: "laptop",
    label: "MacBook in use",
    prompt: "MacBook aberto sobre uma mesa de trabalho com reflexos e marcas de uso",
    preset: "product",
    lookFor: "keyboard geometry, aluminium reflections, plausible wear",
  },
  {
    id: "device",
    label: "Medical device in a clinic",
    prompt: "equipamento médico em um ambiente clínico",
    preset: "clinical",
    lookFor: "moulded plastic, cables, labels, believable machine design",
  },
  {
    id: "corporate",
    label: "Professional in an office",
    prompt: "profissional brasileiro em um escritório moderno",
    preset: "professional",
    lookFor: "does it read as a real employee or as a stock model",
  },
  {
    id: "lifestyle",
    label: "Candid, natural light",
    prompt: "cena espontânea de pessoas brasileiras conversando em luz natural",
    preset: "lifestyle",
    lookFor: "framing looseness, motion, unposed body language",
  },
];

interface LoraPlan {
  id: string | null;
  strength: number | null;
}

export type Suite = "variants" | "lora" | "upscale" | "realism" | "quick";

export interface BenchmarkRun {
  scenario: string;
  label: string;
  preset: PresetName;
  variant: string;
  lora: string | null;
  loraStrength: number | null;
  seed: number;
  width: number;
  height: number;
  file: string;
  /** Wall time of the whole call, including process spawn and model load. */
  totalMs: number;
  backendMs: number;
  coldStart: boolean;
  peakMemoryGB: number;
  swapMB: number;
  bytes: number;
  lookFor: string;
  error?: string;
}

export interface BenchmarkReport {
  suite: Suite;
  startedAt: string;
  finishedAt: string;
  platform: PlatformInfo;
  idleMemoryGB: number;
  outDir: string;
  runs: BenchmarkRun[];
  /** Side-by-side sheets, one per scenario+seed. */
  sheets: string[];
  notes: string[];
}

export interface BenchmarkOptions {
  suite?: Suite;
  variants?: string[];
  scenarios?: string[];
  loras?: (string | null)[];
  strengths?: number[];
  seeds?: number[];
  outDir?: string;
  /** Variant id to write into the user config once measurements are in. */
  apply?: string | boolean;
  onProgress?: (message: string) => void;
}

const QUICK = ["medical", "elderly", "product"];

function pickScenarios(options: BenchmarkOptions): Scenario[] {
  if (options.scenarios?.length) {
    const wanted = new Set(options.scenarios);
    const found = SCENARIOS.filter((s) => wanted.has(s.id));
    if (found.length === 0) throw new Error(`No scenarios matched: ${options.scenarios.join(", ")}`);
    return found;
  }
  if (options.suite === "quick" || options.suite === "variants") {
    return SCENARIOS.filter((s) => QUICK.includes(s.id));
  }
  return SCENARIOS;
}

export async function runBenchmark(options: BenchmarkOptions = {}): Promise<BenchmarkReport> {
  const suite = options.suite ?? "variants";
  const startedAt = new Date().toISOString();
  const platform = await platformInfo();
  const baseConfig = loadConfig();
  const backend = new DrawThingsBackend();
  const notes: string[] = [];

  const stampDir =
    options.outDir ??
    join(repoRoot(), "bench", "results", startedAt.replace(/[:.]/g, "-"));
  ensureDir(stampDir);

  const scenarios = pickScenarios(options);
  const seeds = options.seeds ?? [101, 202];

  // Which axis are we varying?
  let variants: string[];
  let loraPlans: LoraPlan[];

  if (suite === "variants") {
    const catalogue = generator(baseConfig);
    const requested = options.variants ?? catalogue.variants.map((v) => v.id);
    variants = requested.filter((id) => {
      const variant = catalogue.variants.find((v) => v.id === id);
      const installed = variant ? backend.isInstalled(variant.file) : false;
      if (!installed) notes.push(`variant "${id}" skipped: weights not installed`);
      return installed;
    });
    loraPlans = [{ id: null, strength: null }];
  } else if (suite === "lora") {
    variants = [baseConfig.model.variant];
    const strengths = options.strengths ?? [0.25, 0.4, 0.6];
    // Default: raw versus every realism adapter actually installed. Using
    // config.lora.id alone would benchmark nothing on a fresh machine, since
    // the default configuration has no adapter enabled.
    const installed = loadManifest()
      .loras.filter(
        (l) =>
          l.commercial_use_verified &&
          (l.candidate === "primary" || l.candidate === "secondary") &&
          Boolean(installedLoraFile(l)),
      )
      .map((l) => l.id);
    if (installed.length === 0) {
      notes.push(
        "No realism adapter is installed, so this run measures the raw model only. " +
          "Install one with: local-photo lora install <id>",
      );
    }
    const loraIds = (options.loras ?? [null, ...installed]).filter(
      (id, i, arr) => arr.indexOf(id) === i,
    );
    loraPlans = loraIds.flatMap((id): LoraPlan[] =>
      id === null ? [{ id: null, strength: null }] : strengths.map((s) => ({ id, strength: s })),
    );
  } else {
    variants = [baseConfig.model.variant];
    loraPlans = [
      baseConfig.lora.enabled && baseConfig.lora.id
        ? { id: baseConfig.lora.id, strength: baseConfig.lora.strength }
        : { id: null, strength: null },
    ];
  }

  if (variants.length === 0) {
    throw new Error("Nothing to benchmark: no model variants are installed.");
  }

  // Fail before the first frame rather than after every frame: a missing
  // companion file would otherwise produce N identical failures.
  const gen = generator(baseConfig);
  const missing = (gen.companions ?? []).filter((c) => !backend.isInstalled(c.file));
  if (missing.length > 0) {
    throw new Error(
      `${gen.name} is missing ${missing.map((c) => c.role).join(" and ")}. ` +
        "Run: local-photo install-model",
    );
  }

  const idle = await memorySnapshot();
  const runs: BenchmarkRun[] = [];
  const seenVariant = new Set<string>();

  for (const variantId of variants) {
    for (const plan of loraPlans) {
      for (const scenario of scenarios) {
        for (const seed of seeds) {
          const config: Config = JSON.parse(JSON.stringify(baseConfig)) as Config;
          config.model.variant = variantId;
          config.lora.id = plan.id;
          config.lora.enabled = plan.id !== null;
          if (plan.strength !== null) config.lora.strength = plan.strength;
          config.output.format = "png";
          config.output.metadata = true;

          const tag = [
            scenario.id,
            variantId,
            plan.id ? `${plan.id}@${plan.strength}` : "raw",
            `s${seed}`,
          ].join("__");
          const file = join(stampDir, `${tag}.png`);

          // The first run of a variant pays the model-load cost.
          const coldStart = !seenVariant.has(variantId);
          seenVariant.add(variantId);

          options.onProgress?.(`${tag}${coldStart ? " (cold)" : ""}`);

          const service = new LocalPhotoService({ config, backend });
          try {
            const { result, peak } = await withMemoryWatch(() =>
              service.generate({
                prompt: scenario.prompt,
                preset: scenario.preset,
                seed,
                output: file,
                upscale: "off",
              }),
            );

            runs.push({
              scenario: scenario.id,
              label: scenario.label,
              preset: scenario.preset,
              variant: variantId,
              lora: plan.id,
              loraStrength: plan.strength,
              seed,
              width: result.records[0]?.width ?? 0,
              height: result.records[0]?.height ?? 0,
              file: result.files[0]!,
              totalMs: result.timings.totalMs,
              backendMs: result.timings.backendMs,
              coldStart,
              peakMemoryGB: Math.max(0, Math.round((peak.usedGB - idle.usedGB) * 100) / 100),
              swapMB: peak.swapUsedMB,
              bytes: existsSync(result.files[0]!) ? statSync(result.files[0]!).size : 0,
              lookFor: scenario.lookFor,
            });
          } catch (error) {
            runs.push({
              scenario: scenario.id,
              label: scenario.label,
              preset: scenario.preset,
              variant: variantId,
              lora: plan.id,
              loraStrength: plan.strength,
              seed,
              width: 0,
              height: 0,
              file: "",
              totalMs: 0,
              backendMs: 0,
              coldStart,
              peakMemoryGB: 0,
              swapMB: 0,
              bytes: 0,
              lookFor: scenario.lookFor,
              error: error instanceof Error ? error.message : String(error),
            });
            options.onProgress?.(`  failed: ${(error as Error).message.split("\n")[0]}`);
          }
        }
      }
    }
  }

  // One sheet per scenario+seed, so each comparison changes exactly one thing.
  const sheets: string[] = [];
  const groups = new Map<string, BenchmarkRun[]>();
  for (const run of runs) {
    if (run.error || !run.file) continue;
    const key = `${run.scenario}__s${run.seed}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    try {
      const path = await contactSheet({
        cells: group.map((r) => ({
          file: r.file,
          label: `${r.variant}${r.lora ? ` + ${r.lora}@${r.loraStrength}` : " raw"} · ${Math.round(r.totalMs / 100) / 10}s`,
        })),
        output: join(stampDir, `sheet__${key}.jpg`),
        title: `${group[0]!.label} — seed ${group[0]!.seed} — look for: ${group[0]!.lookFor}`,
        cellWidth: 560,
      });
      sheets.push(path);
    } catch (error) {
      notes.push(`contact sheet for ${key} failed: ${(error as Error).message}`);
    }
  }
  if (sheets.length > 0) {
    notes.push(`${sheets.length} contact sheet(s) written for side-by-side judging.`);
  }

  const report: BenchmarkReport = {
    suite,
    startedAt,
    finishedAt: new Date().toISOString(),
    platform,
    idleMemoryGB: idle.usedGB,
    outDir: stampDir,
    runs,
    sheets,
    notes,
  };

  writeFileSync(join(stampDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(join(stampDir, "report.md"), `${formatBenchmark(report)}\n`, "utf8");

  if (typeof options.apply === "string") {
    saveUserConfig({ model: { variant: options.apply } });
    report.notes.push(`Applied model variant "${options.apply}" to the user config.`);
  }

  return report;
}

function ms(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

export function formatBenchmark(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`# Benchmark — ${report.suite}`);
  lines.push("");
  lines.push(
    `${report.platform.chip}, ${report.platform.memoryGB} GB, ${report.platform.os} ${report.platform.osVersion}`,
  );
  lines.push(`Started ${report.startedAt}, idle memory ${report.idleMemoryGB} GB in use.`);
  lines.push(`Images: \`${report.outDir}\``);
  lines.push("");

  const ok = report.runs.filter((r) => !r.error);
  const byVariant = new Map<string, BenchmarkRun[]>();
  for (const run of ok) {
    const key = `${run.variant}${run.lora ? ` + ${run.lora}@${run.loraStrength}` : ""}`;
    byVariant.set(key, [...(byVariant.get(key) ?? []), run]);
  }

  lines.push(
    "In on-demand mode every generation is its own process, so **every** call " +
      "loads the model. The first call after a reboot also pays for reading the " +
      "weights off disk; later calls read them from the OS page cache, which is " +
      "the whole difference between the first row and the rest.",
  );
  lines.push("");
  lines.push("| configuration | runs | first call | median | slowest | peak Δmem | swap |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const [key, group] of byVariant) {
    const times = group.map((r) => r.totalMs).sort((a, b) => a - b);
    const first = group.find((r) => r.coldStart);
    const median = times[Math.floor(times.length / 2)] ?? 0;
    const peak = Math.max(...group.map((r) => r.peakMemoryGB));
    const swap = Math.max(...group.map((r) => r.swapMB));
    lines.push(
      `| ${key} | ${group.length} | ${first ? ms(first.totalMs) : "-"} | ${ms(median)} | ${ms(times[times.length - 1] ?? 0)} | ${peak.toFixed(2)} GB | ${swap.toFixed(1)} MB |`,
    );
  }

  lines.push("");
  lines.push("## Frames");
  lines.push("");
  lines.push("| scenario | configuration | seed | time | file | what to look for |");
  lines.push("| --- | --- | ---: | ---: | --- | --- |");
  for (const run of report.runs) {
    const config = `${run.variant}${run.lora ? ` + ${run.lora}@${run.loraStrength}` : " raw"}`;
    lines.push(
      run.error
        ? `| ${run.scenario} | ${config} | ${run.seed} | FAILED | — | ${run.error.split("\n")[0]} |`
        : `| ${run.scenario} | ${config} | ${run.seed} | ${ms(run.totalMs)} | \`${run.file.split("/").pop()}\` | ${run.lookFor} |`,
    );
  }

  if (report.sheets.length > 0) {
    lines.push("", "## Side-by-side sheets", "");
    for (const sheet of report.sheets) lines.push(`- \`${sheet.split("/").pop()}\``);
  }

  if (report.notes.length > 0) {
    lines.push("", "## Notes", "");
    for (const note of report.notes) lines.push(`- ${note}`);
  }

  return lines.join("\n");
}

