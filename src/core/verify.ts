/**
 * Integrity verification.
 *
 * The manifest records a SHA-256 for every artifact we know one for. This
 * checks what is actually on disk against it. Multi-gigabyte downloads over a
 * throttled CDN do occasionally end up truncated or subtly wrong, and a
 * corrupted checkpoint fails in confusing ways rather than obvious ones.
 *
 * Hashing 11 GB takes a while, so this is a command you run, never something
 * that happens implicitly before a generation.
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { generator, loadConfig, loadManifest } from "./config.js";
import { modelsDir } from "./paths.js";

export interface VerifyEntry {
  file: string;
  role: string;
  status: "ok" | "mismatch" | "missing" | "unknown-checksum" | "repacked";
  sizeGB: number;
  expected: string | null;
  actual: string | null;
  note?: string;
}

export interface VerifyReport {
  modelsDir: string;
  entries: VerifyEntry[];
  ok: boolean;
}

export interface PrunableFile {
  file: string;
  reason: string;
  bytes: number;
}

/**
 * Weights that are on disk but not part of the selected configuration.
 *
 * Benchmarking every model variant is the right way to choose one; keeping all
 * of them afterwards is just 20 GB of indecision. This only *reports* — the
 * deleting is a separate, confirmed step, because re-downloading is measured
 * in hours.
 */
export function prunableWeights(): PrunableFile[] {
  const config = loadConfig();
  const gen = generator(config);
  const dir = modelsDir();
  const out: PrunableFile[] = [];

  const keep = new Set<string>();
  const active = gen.variants.find((v) => v.id === config.model.variant);
  if (active) {
    keep.add(active.file);
    for (const c of (active as { companions?: { file: string }[] }).companions ?? []) keep.add(c.file);
  }
  // The shared companions belong to whichever variant is selected.
  const activeHasOwnEncoder = ((active as { companions?: unknown[] })?.companions ?? []).length > 0;
  for (const c of gen.companions ?? []) {
    if (!activeHasOwnEncoder || !/text encoder/i.test(c.role)) keep.add(c.file);
  }

  for (const variant of gen.variants) {
    if (variant.id === config.model.variant) continue;
    for (const file of [
      variant.file,
      ...((variant as { companions?: { file: string }[] }).companions ?? []).map((c) => c.file),
    ]) {
      if (keep.has(file)) continue;
      const path = join(dir, file);
      if (!existsSync(path)) continue;
      let bytes = statSync(path).size;
      const sidecar = `${path}-tensordata`;
      if (existsSync(sidecar)) bytes += statSync(sidecar).size;
      if (out.some((e) => e.file === file)) continue;
      out.push({ file, reason: `unused variant "${variant.id}"`, bytes });
    }
  }

  return out;
}

async function sha256(path: string, onProgress?: (fraction: number) => void): Promise<string> {
  const total = statSync(path).size;
  let read = 0;
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path, { highWaterMark: 8 * 1024 * 1024 });
    stream.on("data", (chunk) => {
      hash.update(chunk);
      read += chunk.length;
      onProgress?.(read / total);
    });
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return hash.digest("hex").toLowerCase();
}

export interface VerifyOptions {
  /** Only check these files. Default: everything the active config needs. */
  files?: string[];
  /** Include every catalogued variant, not just the active one. */
  all?: boolean;
  onProgress?: (message: string) => void;
}

export async function verifyIntegrity(options: VerifyOptions = {}): Promise<VerifyReport> {
  const config = loadConfig();
  const gen = generator(config);
  const dir = modelsDir();

  const targets: { file: string; role: string; sha: string | null; expectedBytes?: number }[] = [];

  for (const variant of gen.variants) {
    const active = variant.id === config.model.variant;
    if (!options.all && !active) continue;
    targets.push({ file: variant.file, role: `checkpoint (${variant.id})`, sha: variant.sha256 ?? null });
  }
  for (const companion of gen.companions ?? []) {
    targets.push({
      file: companion.file,
      role: companion.role,
      sha: companion.sha256 ?? null,
      ...(companion.size_bytes ? { expectedBytes: companion.size_bytes } : {}),
    });
  }
  for (const lora of loadManifest().loras) {
    if (!lora.file) continue;
    if (!existsSync(join(dir, lora.file))) continue;
    targets.push({ file: lora.file, role: `lora (${lora.id})`, sha: lora.sha256 ?? null });
  }
  for (const upscaler of loadManifest().upscalers) {
    if (!upscaler.file) continue;
    if (!existsSync(join(dir, upscaler.file))) continue;
    targets.push({ file: upscaler.file, role: `upscaler (${upscaler.id})`, sha: upscaler.sha256 ?? null });
  }

  const wanted = options.files ? new Set(options.files) : null;
  const entries: VerifyEntry[] = [];

  for (const target of targets) {
    if (wanted && !wanted.has(target.file)) continue;
    const path = join(dir, target.file);

    if (!existsSync(path)) {
      entries.push({ file: target.file, role: target.role, status: "missing", sizeGB: 0, expected: target.sha, actual: null });
      continue;
    }

    // Draw Things stores some large models split into a small header plus a
    // `-tensordata` sidecar. The bytes on disk are then a repacked container,
    // not the blob the CDN served, so the upstream checksum cannot match
    // either file. Comparing anyway would fail on every healthy install.
    const sidecar = `${path}-tensordata`;
    if (existsSync(sidecar)) {
      const totalBytes = statSync(path).size + statSync(sidecar).size;
      const totalGB = Math.round((totalBytes / 1024 ** 3) * 100) / 100;
      const expected = target.expectedBytes;
      // Repacking changes the container, so the size shifts a little; anything
      // within a couple of percent of the source blob is a complete download.
      const plausible = expected === undefined || Math.abs(totalBytes - expected) / expected < 0.02;
      entries.push({
        file: target.file,
        role: target.role,
        status: plausible ? "repacked" : "mismatch",
        sizeGB: totalGB,
        expected: target.sha,
        actual: null,
        note: plausible
          ? `stored split as .ckpt + -tensordata (${totalGB} GB total); the upstream checksum does not apply to a repacked container`
          : `split storage is ${totalBytes} bytes, expected about ${expected} — the download looks incomplete`,
      });
      continue;
    }

    const sizeGB = Math.round((statSync(path).size / 1024 ** 3) * 100) / 100;

    if (!target.sha) {
      entries.push({ file: target.file, role: target.role, status: "unknown-checksum", sizeGB, expected: null, actual: null });
      continue;
    }

    options.onProgress?.(`hashing ${target.file} (${sizeGB} GB)…`);
    const actual = await sha256(path);
    entries.push({
      file: target.file,
      role: target.role,
      status: actual === target.sha.toLowerCase() ? "ok" : "mismatch",
      sizeGB,
      expected: target.sha.toLowerCase(),
      actual,
    });
  }

  return {
    modelsDir: dir,
    entries,
    ok: entries.every(
      (e) => e.status === "ok" || e.status === "unknown-checksum" || e.status === "repacked",
    ),
  };
}
