/**
 * Every path this project uses, derived at runtime.
 *
 * Nothing here is hardcoded to a username or a machine — the brief requires the
 * repo to clone onto another Apple Silicon Mac and rebuild itself. Environment
 * variables win over defaults so a second machine can put weights on an
 * external volume without editing code.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repo root, whether running from `dist/` or from source. */
export function repoRoot(): string {
  // dist/core/paths.js -> dist/core -> dist -> <root>
  let dir = HERE;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  return resolve(HERE, "../..");
}

/**
 * Draw Things' own model directory lives inside the app's sandbox container and
 * is not writable by outside processes, so we keep our weights in a normal
 * Application Support directory and point the CLI at it.
 */
export function modelsDir(): string {
  const override = process.env.LOCAL_PHOTO_MODELS_DIR ?? process.env.DRAWTHINGS_MODELS_DIR;
  if (override && override.trim()) return resolve(override.trim());
  return join(homedir(), "Library", "Application Support", "local-photo-ai-m5", "models");
}

/** Where user-level state lives (config overrides, benchmark records). */
export function stateDir(): string {
  const override = process.env.LOCAL_PHOTO_STATE_DIR;
  if (override && override.trim()) return resolve(override.trim());
  return join(homedir(), "Library", "Application Support", "local-photo-ai-m5");
}

export function logsDir(): string {
  return join(stateDir(), "logs");
}

/** Default output directory when the caller does not pass --output. */
export function defaultOutputDir(cwd = process.cwd()): string {
  const override = process.env.LOCAL_PHOTO_OUTPUT_DIR;
  if (override && override.trim()) return resolve(override.trim());
  return join(cwd, ".local-photo");
}

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

/** Absolute path to the draw-things-cli binary, or null when unavailable. */
export function drawThingsCliPath(): string | null {
  const override = process.env.LOCAL_PHOTO_DT_CLI;
  if (override && existsSync(override)) return override;

  const candidates = [
    "/opt/homebrew/bin/draw-things-cli",
    "/usr/local/bin/draw-things-cli",
    join(homedir(), ".local", "bin", "draw-things-cli"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Fall back to PATH lookup by the caller.
  return null;
}

export function drawThingsAppPath(): string | null {
  const candidates = [
    "/Applications/Draw Things.app",
    join(homedir(), "Applications", "Draw Things.app"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

export function toolVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot(), "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
