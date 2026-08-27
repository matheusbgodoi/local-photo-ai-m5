/**
 * Draw Things backend.
 *
 * Wraps `draw-things-cli`. Everything above this file speaks in photographs;
 * everything below speaks in checkpoints, samplers and Metal. The seam is here
 * on purpose — the agent must never need to know a ckpt filename.
 *
 * Default mode is on-demand: one process per generation, which exits and gives
 * the memory back. Nothing is left resident.
 */

import { existsSync, statSync } from "node:fs";
import { run, runOrThrow } from "../exec.js";
import { drawThingsCliPath, modelsDir } from "../paths.js";

export interface LoraRef {
  /** Filename as it exists in the models directory. */
  file: string;
  weight: number;
  /** Draw Things needs the base-model family for unregistered local LoRAs. */
  version?: string;
}

/**
 * Optional warm-server target.
 *
 * Draw Things can serve generations over gRPC, which removes the per-call
 * model load. It is never started by this project and never enabled by
 * default — see docs/BENCHMARK.md for why.
 */
export interface RemoteTarget {
  host: string;
  port: number;
  tls: boolean;
  sharedSecret?: string;
}

export interface BackendGenerateRequest {
  model: string;
  prompt: string;
  negativePrompt?: string | null;
  width: number;
  height: number;
  steps: number;
  guidance: number;
  seed: number;
  output: string;
  loras?: LoraRef[];
  sampler?: string;
  /** img2img source. */
  image?: string;
  strength?: number;
  /** Extra JSGenerationConfiguration keys merged last. */
  configOverrides?: Record<string, unknown>;
  offline?: boolean;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface BackendResult {
  file: string;
  durationMs: number;
  command: string;
}

export interface CatalogEntry {
  file: string;
  name: string;
  source: string;
  downloaded: boolean;
  huggingFace: string | null;
}

export class DrawThingsBackend {
  readonly name = "draw-things-cli";

  constructor(
    private readonly cliPath: string = drawThingsCliPath() ?? "draw-things-cli",
    private readonly models: string = modelsDir(),
    /** When set, generations are routed to a warm server instead of loading locally. */
    private readonly remote: RemoteTarget | null = null,
  ) {}

  get modelsDirectory(): string {
    return this.models;
  }

  get binary(): string {
    return this.cliPath;
  }

  get remoteTarget(): RemoteTarget | null {
    return this.remote;
  }

  available(): boolean {
    return this.cliPath === "draw-things-cli" || existsSync(this.cliPath);
  }

  /**
   * `draw-things-cli --version` prints the literal string "dev" even for the
   * released Homebrew bottle, so it is useless for reporting. Ask Homebrew
   * instead, and only fall back to the binary when brew has no record of it.
   */
  async version(): Promise<string | null> {
    try {
      const brewed = await run("brew", ["list", "--versions", "draw-things-cli"], {
        timeoutMs: 20_000,
      });
      const match = /draw-things-cli\s+(\S+)/.exec(brewed.stdout);
      if (match) return match[1]!;
    } catch {
      // brew is optional; fall through.
    }

    try {
      const result = await run(this.cliPath, ["--version"], { timeoutMs: 15_000 });
      const text = `${result.stdout}${result.stderr}`.trim().split("\n")[0]?.trim();
      if (!text) return null;
      return text === "dev" ? "installed (version not reported)" : text;
    } catch {
      return null;
    }
  }

  /**
   * Lists the catalog. `--offline` keeps this usable with no network, which
   * matters because `doctor` must work on a plane.
   */
  async catalog(options: { downloadedOnly?: boolean; offline?: boolean } = {}): Promise<CatalogEntry[]> {
    const args = ["models", "list", "--models-dir", this.models];
    if (options.downloadedOnly) args.push("--downloaded-only");
    if (options.offline !== false) args.push("--offline");

    const result = await run(this.cliPath, args, { timeoutMs: 60_000 });
    if (result.code !== 0) return [];

    const entries: CatalogEntry[] = [];
    for (const line of result.stdout.split("\n")) {
      // MODEL  NAME  SOURCE  DOWNLOADED  HUGGING_FACE, whitespace-aligned.
      const match = /^(\S+\.ckpt)\s{2,}(.+?)\s{2,}(official|community)\s{2,}(yes|no)\s*(.*)$/.exec(
        line.trim(),
      );
      if (!match) continue;
      const [, file, name, source, downloaded, hf] = match;
      entries.push({
        file: file!,
        name: name!.trim(),
        source: source!,
        downloaded: downloaded === "yes",
        huggingFace: hf && hf.trim() !== "-" ? hf.trim() : null,
      });
    }
    return entries;
  }

  /** True when the weights are actually present on disk (not just catalogued). */
  isInstalled(modelFile: string): boolean {
    const path = `${this.models}/${modelFile}`;
    try {
      return existsSync(path) && statSync(path).size > 1024;
    } catch {
      return false;
    }
  }

  /** Downloads a model and its dependencies. Long-running by nature. */
  async ensureModel(
    modelFile: string,
    options: { signal?: AbortSignal; onProgress?: (m: string) => void } = {},
  ): Promise<void> {
    if (this.isInstalled(modelFile)) return;
    await runOrThrow(
      this.cliPath,
      ["models", "ensure", "--models-dir", this.models, "--model", modelFile],
      {
        signal: options.signal,
        onLine: (line) => options.onProgress?.(line),
      },
    );
  }

  /** Imports a local .safetensors (e.g. a LoRA) into Draw Things' format. */
  async importArtifact(
    artifact: string,
    options: { name?: string; triggerWord?: string; signal?: AbortSignal; onProgress?: (m: string) => void } = {},
  ): Promise<string> {
    const args = ["models", "import", "--models-dir", this.models];
    if (options.name) args.push("--name", options.name);
    if (options.triggerWord) args.push("--trigger-word", options.triggerWord);
    args.push(artifact);

    const result = await runOrThrow(this.cliPath, args, {
      signal: options.signal,
      onLine: (line) => options.onProgress?.(line),
    });
    return result.stdout.trim();
  }

  buildGenerateArgs(request: BackendGenerateRequest): string[] {
    const args = [
      "generate",
      "--models-dir",
      this.models,
      "--model",
      request.model,
      "--prompt",
      request.prompt,
      "--width",
      String(request.width),
      "--height",
      String(request.height),
      "--steps",
      String(request.steps),
      "--cfg",
      String(request.guidance),
      "--seed",
      String(request.seed),
      "--output",
      request.output,
      "--disable-preview",
    ];

    if (request.negativePrompt) args.push("--negative-prompt", request.negativePrompt);
    if (request.image) {
      args.push("--image", request.image);
      if (typeof request.strength === "number") args.push("--strength", String(request.strength));
    }

    const config: Record<string, unknown> = { ...(request.configOverrides ?? {}) };
    if (request.sampler) config.sampler = request.sampler;
    if (request.loras && request.loras.length > 0) {
      config.loras = request.loras.map((lora) => ({
        file: lora.file,
        weight: lora.weight,
        ...(lora.version ? { version: lora.version } : {}),
      }));
    }
    if (Object.keys(config).length > 0) {
      args.push("--config-json", JSON.stringify(config));
    }

    if (this.remote) {
      args.push("--remote", "--remote-url", this.remote.host, "--remote-port", String(this.remote.port));
      args.push(this.remote.tls ? "--remote-tls" : "--no-remote-tls");
      if (this.remote.sharedSecret) args.push("--remote-shared-secret", this.remote.sharedSecret);
      // A remote backend resolves its own weights; --offline would be a lie.
      return args;
    }

    // Weights are installed deliberately by the installer, never as a surprise
    // mid-generation download.
    args.push(request.offline === false ? "--download-missing" : "--no-download-missing");
    if (request.offline !== false) args.push("--offline");

    return args;
  }

  async generate(request: BackendGenerateRequest): Promise<BackendResult> {
    const args = this.buildGenerateArgs(request);
    const result = await run(this.cliPath, args, {
      signal: request.signal,
      onLine: (line) => request.onProgress?.(line),
    });

    if (result.code !== 0) {
      const detail = [result.stderr.trim(), result.stdout.trim()]
        .filter(Boolean)
        .join("\n")
        .slice(-1500);
      throw new Error(`draw-things-cli generate failed (exit ${result.code}).\n${detail}`);
    }
    if (!existsSync(request.output)) {
      throw new Error(
        `draw-things-cli reported success but wrote no file at ${request.output}.\n` +
          `${result.stdout.trim() || result.lastProgress}`,
      );
    }

    return {
      file: request.output,
      durationMs: result.durationMs,
      command: [this.cliPath, ...args].join(" "),
    };
  }
}
