/**
 * Configuration and the component manifest.
 *
 * Two layers: what the repo ships (config/) and what this machine decided
 * (state dir). Benchmarks write their verdict into the second layer, so a fresh
 * clone starts from the shipped defaults and then learns from its own hardware.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, repoRoot, stateDir } from "./paths.js";
import type { PresetName, UpscaleMode } from "./types.js";

export interface ModelVariant {
  id: string;
  file: string;
  catalog_name: string;
  quantisation: string;
  catalog_source: string;
  sha256?: string;
  download_url?: string;
}

export interface CompanionFile {
  file: string;
  role: string;
  size_gb: number;
  /** Exact byte count from the CDN. Use this, never the rounded GB figure. */
  size_bytes?: number;
  sha256?: string;
  download_url?: string;
}

export interface GeneratorManifest {
  id: string;
  name: string;
  family: string;
  source: string;
  upstream: string;
  license: string;
  license_source: string;
  commercial_use_verified: boolean;
  default_variant: string;
  variants: ModelVariant[];
  companions?: CompanionFile[];
  upstream_recommended?: {
    steps: number;
    guidance_scale_diffusers: number;
    samplers_supported: string[];
    note: string;
  };
}

export interface UpscalerManifest {
  id: string;
  name: string;
  file?: string;
  source: string;
  upstream?: string;
  download_url?: string;
  sha256?: string;
  license: string;
  license_source?: string;
  commercial_use_verified: boolean;
  enabled_by_default: boolean;
  /** How this upscaler is actually invoked. */
  kind?: "lanczos" | "esrgan" | "generative-restorer";
  /** Native scale factor for ESRGAN entries. Draw Things honours only 2 and 4. */
  scale?: 2 | 4;
  rejection_reason?: string;
  note?: string;
}

export interface LoraManifest {
  id: string;
  name: string;
  creator: string;
  source: string;
  civitai_model_id?: number;
  civitai_version_id?: number;
  file?: string;
  size_mb?: number;
  sha256?: string;
  base_model?: string;
  trigger_words?: string[];
  author_recommended_strength?: [number, number];
  license: string;
  license_flags?: Record<string, unknown>;
  commercial_use_verified: boolean;
  license_source?: string;
  /** A licence-clean, token-free download route, when one exists. */
  mirror?: {
    source: string;
    repo?: string;
    url: string;
    size_bytes?: number;
    sha256?: string;
    license: string;
    license_source: string;
    requires_token: boolean;
  };
  candidate: "primary" | "secondary" | "optional-style" | "not-recommended" | "rejected";
  rejection_reason?: string;
  note?: string;
}

export interface Manifest {
  schema: number;
  verified_at: string;
  generators: GeneratorManifest[];
  upscalers: UpscalerManifest[];
  loras: LoraManifest[];
}

export interface Config {
  schema: number;
  model: {
    id: string;
    variant: string;
    steps: number;
    guidance: number;
    sampler: string | null;
    baseSize: number;
    sizeStride: number;
  };
  lora: {
    id: string | null;
    enabled: boolean;
    strength: number;
  };
  upscale: {
    mode: UpscaleMode;
    upscaler: string;
    scale: number;
  };
  /** Optional warm server. Never started by this project; off by default. */
  warm?: {
    enabled: boolean;
    host: string;
    port: number;
  };
  finish: {
    enabled: boolean;
    grain: number;
    sharpen: number;
    tone: number;
  };
  output: {
    format: "jpg" | "png" | "webp";
    quality: number;
    metadata: boolean;
  };
  preset: PresetName;
}

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw new Error(`Could not parse ${path}: ${(error as Error).message}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(override)) return base;
  if (!isPlainObject(base)) return override as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

export function manifestPath(): string {
  return join(repoRoot(), "config", "models.json");
}

export function userConfigPath(): string {
  return join(stateDir(), "config.json");
}

let manifestCache: Manifest | null = null;

export function loadManifest(): Manifest {
  if (manifestCache) return manifestCache;
  const manifest = readJson<Manifest>(manifestPath());
  if (!manifest) throw new Error(`Model manifest missing at ${manifestPath()}`);
  manifestCache = manifest;
  return manifest;
}

export function loadConfig(): Config {
  const shipped = readJson<Config>(join(repoRoot(), "config", "default.json"));
  if (!shipped) throw new Error("config/default.json is missing — the checkout is incomplete.");
  const user = readJson<Partial<Config>>(userConfigPath());
  return deepMerge(shipped, user);
}

/** Persists a partial override to the state directory. */
export function saveUserConfig(patch: Record<string, unknown>): string {
  ensureDir(stateDir());
  const path = userConfigPath();
  const current = readJson<Record<string, unknown>>(path) ?? {};
  const next = deepMerge(current, patch);
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return path;
}

// --- manifest lookups -------------------------------------------------------

export function generator(config: Config = loadConfig()): GeneratorManifest {
  const found = loadManifest().generators.find((g) => g.id === config.model.id);
  if (!found) throw new Error(`Unknown generator "${config.model.id}" in config.`);
  return found;
}

export function activeVariant(config: Config = loadConfig()): ModelVariant {
  const gen = generator(config);
  const wanted = config.model.variant || gen.default_variant;
  const found = gen.variants.find((v) => v.id === wanted);
  if (!found) {
    throw new Error(
      `Unknown variant "${wanted}" for ${gen.id}. Known: ${gen.variants.map((v) => v.id).join(", ")}`,
    );
  }
  return found;
}

export function loraById(id: string): LoraManifest | undefined {
  return loadManifest().loras.find((l) => l.id === id);
}

export function upscalerById(id: string): UpscalerManifest | undefined {
  return loadManifest().upscalers.find((u) => u.id === id);
}

/**
 * A component may only be used in production output when its licence has been
 * verified to allow commercial use. This is enforced, not merely documented.
 */
export function assertCommerciallyUsable(component: { name: string; commercial_use_verified: boolean; rejection_reason?: string }): void {
  if (component.commercial_use_verified) return;
  throw new Error(
    `"${component.name}" is not cleared for commercial use, so it cannot be enabled.\n` +
      (component.rejection_reason ? `Reason: ${component.rejection_reason}\n` : "") +
      `See docs/MODELS.md.`,
  );
}
