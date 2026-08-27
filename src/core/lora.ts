/**
 * LoRA management.
 *
 * Generic on purpose: the core is never hardcoded to one adapter file. A LoRA
 * is a manifest entry with a licence, a checksum and a strength — swapping it
 * is configuration, not a code change.
 *
 * Two rules are enforced here rather than merely documented:
 *   1. Nothing whose commercial use is unverified can be installed or enabled.
 *   2. Downloaded weights are checksum-verified before they are imported.
 */

import { createHash } from "node:crypto";
import { createWriteStream, existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  assertCommerciallyUsable,
  loadConfig,
  loadManifest,
  loraById,
  upscalerById,
  type LoraManifest,
} from "./config.js";
import { ensureDir, modelsDir, repoRoot, stateDir } from "./paths.js";

export interface LoraStatusRow {
  id: string;
  name: string;
  base: string | undefined;
  commercial: boolean;
  installed: boolean;
  active: boolean;
  candidate: string;
}

/** Reads CIVITAI_TOKEN from the environment, or from a .env in the repo root. */
export async function civitaiToken(): Promise<string | null> {
  if (process.env.CIVITAI_TOKEN?.trim()) return process.env.CIVITAI_TOKEN.trim();
  for (const dir of [repoRoot(), stateDir()]) {
    const envPath = join(dir, ".env");
    if (!existsSync(envPath)) continue;
    const text = await readFile(envPath, "utf8");
    const match = /^\s*CIVITAI_TOKEN\s*=\s*(.+)\s*$/m.exec(text);
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return null;
}

/**
 * A manifest LoRA is "installed" when a Draw Things artifact carrying its name
 * exists. The importer renames files, so we match on the stem rather than
 * assuming an exact filename.
 */
export function installedLoraFile(lora: LoraManifest): string | null {
  const dir = modelsDir();
  if (!existsSync(dir)) return null;
  if (lora.file && existsSync(join(dir, lora.file))) return lora.file;

  const stem = (lora.file ?? lora.id).replace(/\.(safetensors|ckpt)$/i, "").toLowerCase();
  const candidates = readdirSync(dir).filter((f) => /\.(ckpt|safetensors)$/i.test(f));
  const normalised = stem.replace(/[^a-z0-9]/g, "");
  const hit = candidates.find(
    (f) => f.toLowerCase().replace(/[^a-z0-9]/g, "").includes(normalised.slice(0, 20)),
  );
  return hit ?? null;
}

export async function listLoraStatus(): Promise<LoraStatusRow[]> {
  const config = loadConfig();
  return loadManifest().loras.map((lora) => ({
    id: lora.id,
    name: lora.name,
    base: lora.base_model,
    commercial: lora.commercial_use_verified,
    installed: Boolean(installedLoraFile(lora)),
    active: config.lora.enabled && config.lora.id === lora.id,
    candidate: lora.candidate,
  }));
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = (await import("node:fs")).createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex").toUpperCase();
}

export interface InstallLoraOptions {
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
  /** Skip the checksum comparison. Only for manifest entries with no sha256. */
  force?: boolean;
}

export async function installLora(id: string, options: InstallLoraOptions = {}): Promise<string> {
  const lora = loraById(id);
  if (!lora) throw new Error(`Unknown LoRA "${id}". Run: local-photo lora list`);
  assertCommerciallyUsable(lora);

  const existing = installedLoraFile(lora);
  if (existing) {
    options.onProgress?.(`already installed: ${existing}`);
    return join(modelsDir(), existing);
  }

  // Prefer a token-free mirror when the manifest records one: fewer moving
  // parts, and its licence grant is usually more explicit than Civitai's flags.
  let url: string;
  let headers: Record<string, string> = {};

  if (lora.mirror && !lora.mirror.requires_token) {
    url = lora.mirror.url;
    options.onProgress?.(`using ${lora.mirror.source} mirror (${lora.mirror.license})`);
  } else if (lora.source === "civitai" && lora.civitai_version_id) {
    const token = await civitaiToken();
    if (!token) {
      throw new Error(
        "Civitai downloads require an API token.\n" +
          "  1. Create one at https://civitai.com/user/account (API Keys)\n" +
          "  2. Put it in .env as CIVITAI_TOKEN=... (the file is git-ignored)\n" +
          `  3. Re-run: local-photo lora install ${id}`,
      );
    }
    url = `https://civitai.com/api/download/models/${lora.civitai_version_id}`;
    headers = { Authorization: `Bearer ${token}` };
  } else {
    throw new Error(`No download route recorded for "${lora.name}" in config/models.json.`);
  }

  const downloadDir = ensureDir(join(stateDir(), "downloads"));
  const target = join(downloadDir, lora.file ?? `${lora.id}.safetensors`);
  const partial = `${target}.partial`;

  options.onProgress?.(`downloading ${lora.name}…`);
  const response = await fetch(url, {
    headers,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Download of ${lora.name} returned HTTP ${response.status} from ${new URL(url).host}. ` +
        (response.status === 401
          ? "The token was rejected — check CIVITAI_TOKEN."
          : "The version may have been removed or gated."),
    );
  }

  rmSync(partial, { force: true });
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial));

  if (lora.sha256 && !options.force) {
    options.onProgress?.("verifying checksum…");
    const digest = await sha256File(partial);
    if (digest !== lora.sha256.toUpperCase()) {
      rmSync(partial, { force: true });
      throw new Error(
        `Checksum mismatch for ${lora.name}.\n  expected ${lora.sha256}\n  got      ${digest}\n` +
          "Refusing to install a file that is not what the manifest recorded.",
      );
    }
  }
  renameSync(partial, target);

  // Do NOT use `draw-things-cli models import` here. That command imports a
  // *base model*: given a LoRA it happily produces a full custom-model
  // specification with a text encoder and autoencoder attached, which is not
  // what a LoRA is. The documented route for a local adapter is to place the
  // file in the models directory and reference it from --config-json with an
  // explicit `version`, which is what the backend does.
  const installedPath = join(ensureDir(modelsDir()), lora.file ?? `${lora.id}.safetensors`);
  renameSync(target, installedPath);

  options.onProgress?.(
    `installed ${(statSync(installedPath).size / 1024 ** 2).toFixed(0)} MB at ${installedPath}`,
  );
  return installedPath;
}

/**
 * Downloads an upscaler.
 *
 * `draw-things-cli models ensure` cannot fetch these: it resolves names through
 * the ModelZoo, and upscalers live in a separate UpscalerZoo that the CLI does
 * not expose. So we fetch the file from the same CDN the app uses and verify it
 * against the checksum in the manifest.
 */
export async function installUpscaler(
  id: string,
  options: InstallLoraOptions = {},
): Promise<string> {
  const upscaler = upscalerById(id);
  if (!upscaler) throw new Error(`Unknown upscaler "${id}".`);
  assertCommerciallyUsable(upscaler);
  if (!upscaler.file) throw new Error(`"${upscaler.name}" needs no download.`);

  const dir = ensureDir(modelsDir());
  const target = join(dir, upscaler.file);
  if (existsSync(target) && statSync(target).size > 1024) {
    options.onProgress?.(`already installed: ${upscaler.file}`);
    return target;
  }

  const files: { file: string; url: string; sha?: string }[] = [
    {
      file: upscaler.file,
      url: upscaler.download_url ?? `https://static.libnnc.org/${upscaler.file}`,
      ...(upscaler.sha256 ? { sha: upscaler.sha256 } : {}),
    },
    ...((upscaler as { companions?: { file: string }[] }).companions ?? []).map((c) => ({
      file: c.file,
      url: `https://static.libnnc.org/${c.file}`,
    })),
  ];

  for (const entry of files) {
    const path = join(dir, entry.file);
    if (existsSync(path) && statSync(path).size > 1024) continue;

    options.onProgress?.(`downloading ${entry.file}…`);
    const response = await fetch(entry.url, options.signal ? { signal: options.signal } : {});
    if (!response.ok || !response.body) {
      throw new Error(`Download of ${entry.file} returned HTTP ${response.status}.`);
    }
    const partial = `${path}.partial`;
    rmSync(partial, { force: true });
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial));

    if (entry.sha) {
      const digest = (await sha256File(partial)).toLowerCase();
      if (digest !== entry.sha.toLowerCase()) {
        rmSync(partial, { force: true });
        throw new Error(
          `Checksum mismatch for ${entry.file}.\n  expected ${entry.sha}\n  got      ${digest}`,
        );
      }
    }
    renameSync(partial, path);
  }

  options.onProgress?.(`installed ${upscaler.name}`);
  return target;
}

/**
 * Draw Things needs the base-model family for any LoRA that is not registered
 * in its own custom_lora.json. Guessing wrong silently produces a no-op
 * adapter, so an unknown family raises instead of defaulting.
 */
const LORA_FAMILIES: Record<string, string> = {
  zimageturbo: "z_image",
  zimagebase: "z_image",
  zimage: "z_image",
};

export function loraVersionFor(lora: LoraManifest): string {
  const key = (lora.base_model ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const version = LORA_FAMILIES[key];
  if (!version) {
    throw new Error(
      `No Draw Things LoRA family mapping for base model "${lora.base_model ?? "unknown"}" ` +
        `(${lora.id}). Add one to LORA_FAMILIES in src/core/lora.ts before enabling it.`,
    );
  }
  return version;
}
