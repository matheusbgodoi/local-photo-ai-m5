/**
 * The service. One class, one contract, every front-end on top of it.
 *
 * Callers ask for a photograph. This decides the checkpoint, the size, the
 * sampling, whether a LoRA participates, whether anything gets upscaled and
 * what the file is called. That division is the whole point: the agent stays
 * out of the diffusion weeds.
 */

import { existsSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { randomInt } from "node:crypto";

import { DrawThingsBackend, type LoraRef } from "./backend/drawthings.js";
import {
  activeVariant,
  assertCommerciallyUsable,
  generator,
  loadConfig,
  loraById,
  upscalerById,
  type Config,
} from "./config.js";
import { finishImage, resampleUpscale, sanityCheck } from "./finish.js";
import { installedLoraFile, loraVersionFor } from "./lora.js";
import { defaultOutputDir, ensureDir, drawThingsAppPath, modelsDir, toolVersion } from "./paths.js";
import { buildPrompt } from "./prompt/engine.js";
import { resolveSize } from "./sizes.js";
import { freeDiskGB, platformInfo } from "./system.js";
import type {
  Check,
  GenerateOptions,
  HealthResult,
  PhotoRecord,
  PhotoResult,
  PhotoService,
  PresetName,
  UpscaleOptions,
} from "./types.js";

/** Filenames should be readable at a glance in a repo diff. */
function slugify(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "photo"
  );
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

/**
 * Where the unscaled render is kept when the delivered file is an upscale of
 * it: `assets/doctor.jpg` -> `assets/doctor.raw.jpg`. Same directory, same
 * format, and never the path the caller asked for — that one stays the final
 * artifact.
 */
export function rawSiblingFor(finalPath: string): string {
  const ext = extname(finalPath);
  return `${finalPath.slice(0, finalPath.length - ext.length)}.raw${ext}`;
}

export interface ServiceOptions {
  config?: Config;
  backend?: DrawThingsBackend;
  cwd?: string;
}

export class LocalPhotoService implements PhotoService {
  private readonly config: Config;
  private readonly backend: DrawThingsBackend;
  private readonly cwd: string;

  constructor(options: ServiceOptions = {}) {
    this.config = options.config ?? loadConfig();
    const warm = this.config.warm;
    this.backend =
      options.backend ??
      new DrawThingsBackend(
        undefined,
        undefined,
        warm?.enabled ? { host: warm.host, port: warm.port, tls: false } : null,
      );
    this.cwd = options.cwd ?? process.cwd();
  }

  get configuration(): Config {
    return this.config;
  }

  // -------------------------------------------------------------------------
  // health
  // -------------------------------------------------------------------------

  async health(): Promise<HealthResult> {
    const checks: Check[] = [];
    const platform = await platformInfo();
    const models = modelsDir();

    checks.push({
      id: "platform",
      label: "Apple Silicon",
      status: platform.appleSilicon ? "ok" : "fail",
      detail: `${platform.chip}, ${platform.memoryGB} GB unified memory, ${platform.cores} cores`,
      hint: platform.appleSilicon ? undefined : "This project targets Apple Silicon Macs.",
    });

    const app = drawThingsAppPath();
    checks.push({
      id: "draw-things-app",
      label: "Draw Things.app",
      status: app ? "ok" : "warn",
      detail: app ?? "not installed",
      hint: app ? undefined : "brew install --cask draw-things (only needed for manual use)",
    });

    const cliVersion = this.backend.available() ? await this.backend.version() : null;
    checks.push({
      id: "draw-things-cli",
      label: "draw-things-cli",
      status: cliVersion ? "ok" : "fail",
      detail: cliVersion ?? "not found",
      hint: cliVersion ? undefined : "brew install draw-things-cli",
    });

    const variant = activeVariant(this.config);
    const gen = generator(this.config);
    // The checkpoint alone is not enough: Z-Image needs its text encoder and
    // autoencoder, which are separate multi-gigabyte downloads. Reporting
    // "ready" with those missing would only move the failure to generate time.
    const missingCompanions = (gen.companions ?? [])
      .filter((c) => !this.backend.isInstalled(c.file))
      .map((c) => c.role);
    const checkpointReady = this.backend.isInstalled(variant.file);
    const modelReady = checkpointReady && missingCompanions.length === 0;

    checks.push({
      id: "model",
      label: `${gen.name} (${variant.catalog_name})`,
      status: modelReady ? "ok" : "fail",
      detail: !checkpointReady
        ? `${variant.file} missing from ${models}`
        : missingCompanions.length > 0
          ? `checkpoint present, still missing: ${missingCompanions.join(", ")}`
          : `${variant.file} — ${this.fileSizeGB(join(models, variant.file))} GB`,
      hint: modelReady ? undefined : "local-photo install-model",
    });

    checks.push({
      id: "prompt-engine",
      label: "Photography prompt engine",
      status: "ok",
      detail: `preset "${this.config.preset}" by default`,
    });

    const upscaler = upscalerById(this.config.upscale.upscaler);
    const lora = this.config.lora.id ? loraById(this.config.lora.id) : undefined;
    const loraInstalled = lora ? Boolean(installedLoraFile(lora)) : false;
    checks.push({
      id: "lora",
      label: "Realism LoRA",
      status: !this.config.lora.enabled ? "disabled" : loraInstalled ? "ok" : "warn",
      detail: !lora
        ? "none configured — raw model + prompt engine"
        : `${lora.name} @ ${this.config.lora.strength}` +
          (loraInstalled ? "" : " (file not installed)"),
      hint: lora && !lora.commercial_use_verified ? "Commercial use NOT verified — must stay off." : undefined,
    });

    // These assets go into company marketing, so licence status is a
    // first-class check rather than a footnote in a doc.
    const productionComponents = [
      { name: gen.name, verified: gen.commercial_use_verified },
      ...(lora ? [{ name: lora.name, verified: lora.commercial_use_verified }] : []),
      ...(this.config.upscale.mode !== "off" && upscaler
        ? [{ name: upscaler.name, verified: upscaler.commercial_use_verified }]
        : []),
    ];
    const unverified = productionComponents.filter((c) => !c.verified);
    checks.push({
      id: "commercial-use",
      label: "Commercial use",
      status: unverified.length === 0 ? "ok" : "fail",
      detail:
        unverified.length === 0
          ? `verified for ${productionComponents.map((c) => c.name).join(", ")}`
          : `NOT verified: ${unverified.map((c) => c.name).join(", ")}`,
      hint: unverified.length === 0 ? undefined : "See docs/MODELS.md",
    });

    const upscalerReady =
      upscaler?.file ? this.backend.isInstalled(upscaler.file) : Boolean(upscaler);
    checks.push({
      id: "upscaler",
      label: "Upscaler",
      status: this.config.upscale.mode === "off" ? "disabled" : upscalerReady ? "ok" : "warn",
      detail: `${upscaler?.name ?? "none"} — mode "${this.config.upscale.mode}"`,
    });

    const free = freeDiskGB(models);
    checks.push({
      id: "disk",
      label: "Free disk",
      status: free < 0 ? "warn" : free < 10 ? "fail" : free < 30 ? "warn" : "ok",
      detail: free < 0 ? "unknown" : `${free} GB free at ${models}`,
    });

    return {
      ok: checks.every((c) => c.status !== "fail"),
      checks,
      platform: {
        os: `${platform.os} ${platform.osVersion}`,
        chip: platform.chip,
        memoryGB: platform.memoryGB,
        freeDiskGB: free,
      },
      engine: {
        name: "Draw Things",
        version: cliVersion,
        mode: this.config.warm?.enabled ? "warm" : "on-demand",
      },
      model: { id: gen.id, variant: variant.id, ready: modelReady },
      lora: {
        id: lora?.id ?? null,
        enabled: this.config.lora.enabled && loraInstalled,
        commercialUseVerified: lora ? lora.commercial_use_verified : null,
      },
      upscaler: {
        id: upscaler?.id ?? null,
        enabled: this.config.upscale.mode !== "off",
      },
    };
  }

  private fileSizeGB(path: string): string {
    try {
      return (statSync(path).size / 1024 ** 3).toFixed(2);
    } catch {
      return "?";
    }
  }

  // -------------------------------------------------------------------------
  // generate
  // -------------------------------------------------------------------------

  private resolveLora(options: GenerateOptions): { ref: LoraRef | null; manifestId: string | null; strength: number | null } {
    if (options.lora === false) return { ref: null, manifestId: null, strength: null };

    const wantedId = typeof options.lora === "string" ? options.lora : this.config.lora.id;
    const enabled = typeof options.lora === "string" ? true : this.config.lora.enabled;
    if (!wantedId || !enabled) return { ref: null, manifestId: null, strength: null };

    const lora = loraById(wantedId);
    if (!lora) throw new Error(`Unknown LoRA "${wantedId}". Run: local-photo lora list`);
    assertCommerciallyUsable(lora);
    const installedFile = installedLoraFile(lora);
    if (!installedFile) {
      throw new Error(
        `LoRA "${lora.name}" is configured but its weights are not installed.\n` +
          `Run: local-photo lora install ${lora.id}`,
      );
    }

    const strength = options.loraStrength ?? this.config.lora.strength;
    return {
      ref: { file: installedFile, weight: strength, version: loraVersionFor(lora) },
      manifestId: lora.id,
      strength,
    };
  }

  private outputPathsFor(options: GenerateOptions, count: number, subject: string): string[] {
    const format = this.config.output.format;
    const explicit = options.output?.trim();

    if (explicit) {
      const abs = isAbsolute(explicit) ? explicit : resolve(this.cwd, explicit);
      const looksLikeDir = explicit.endsWith("/") || (existsSync(abs) && statSync(abs).isDirectory());
      if (looksLikeDir) {
        ensureDir(abs);
        return Array.from({ length: count }, (_, i) =>
          join(abs, `${slugify(subject)}-${stamp()}${count > 1 ? `-${i + 1}` : ""}.${format}`),
        );
      }
      ensureDir(dirname(abs));
      if (count === 1) return [abs];
      const ext = extname(abs) || `.${format}`;
      const stem = abs.slice(0, abs.length - ext.length);
      return Array.from({ length: count }, (_, i) => `${stem}-${i + 1}${ext}`);
    }

    const dir = ensureDir(defaultOutputDir(this.cwd));
    const base = `${slugify(subject)}-${stamp()}`;
    return Array.from({ length: count }, (_, i) =>
      join(dir, `${base}${count > 1 ? `-${i + 1}` : ""}.${format}`),
    );
  }

  async generate(options: GenerateOptions): Promise<PhotoResult> {
    const started = Date.now();
    if (!options.prompt || !options.prompt.trim()) {
      throw new Error("A prompt is required.");
    }

    const variant = activeVariant(this.config);
    const gen = generator(this.config);
    if (!this.backend.isInstalled(variant.file)) {
      throw new Error(
        `${gen.name} (${variant.catalog_name}) is not installed at ${modelsDir()}.\n` +
          `Run: local-photo install-model`,
      );
    }
    const missing = (gen.companions ?? []).filter((c) => !this.backend.isInstalled(c.file));
    if (missing.length > 0) {
      throw new Error(
        `${gen.name} is missing required companion files: ` +
          `${missing.map((c) => `${c.file} (${c.role})`).join(", ")}.\n` +
          `Run: local-photo install-model`,
      );
    }

    const count = Math.max(1, Math.min(8, options.count ?? 1));
    const preset = (options.preset ?? this.config.preset) as PresetName;
    const size = resolveSize({
      width: options.width,
      height: options.height,
      size: options.size,
      baseSize: this.config.model.baseSize,
      stride: this.config.model.sizeStride,
    });

    const steps = options.steps ?? this.config.model.steps;
    const guidance = options.guidance ?? this.config.model.guidance;
    // A distilled turbo model runs at CFG 1, where the negative branch is not
    // even evaluated. Advertising a negative prompt there would be theatre.
    const allowNegative = guidance > 1.05;

    const lora = this.resolveLora(options);
    const seeds = Array.from({ length: count }, () =>
      options.seed !== undefined ? options.seed : randomInt(0, 2 ** 31 - 1),
    );
    if (options.seed !== undefined && count > 1) {
      // Same seed for every frame would return N identical images.
      for (let i = 1; i < count; i++) seeds[i] = options.seed + i;
    }

    // Peek at the subject once for naming, using the first seed.
    const naming = buildPrompt({ prompt: options.prompt, preset, seed: seeds[0]!, allowNegative });
    const outputs = this.outputPathsFor(options, count, naming.subject);

    const files: string[] = [];
    const rawFiles: string[] = [];
    const metadataFiles: string[] = [];
    const records: PhotoRecord[] = [];
    let backendMs = 0;
    let upscaleMs = 0;
    let finishMs = 0;

    // Intermediates are hidden files next to the target. Track them so a
    // failure halfway through does not litter the caller's asset directory.
    const scratch: string[] = [];

    try {
      for (let i = 0; i < count; i++) {
        const seed = seeds[i]!;
        const finalPath = outputs[i]!;
        const engineOut = options.raw
          ? {
              positive: options.prompt,
              negative: options.negativePrompt ?? null,
              rationale: ["raw mode: prompt passed through untouched"],
              subject: options.prompt,
            }
          : buildPrompt({ prompt: options.prompt, preset, seed, allowNegative, hints: options.hints });

        const negative = options.negativePrompt ?? engineOut.negative;

        // The CLI writes PNG; the delivery format is decided by the finish pass.
        const rawPath = join(dirname(finalPath), `.${basename(finalPath)}.raw.png`);
        scratch.push(rawPath);

        options.onProgress?.(`generating ${i + 1}/${count} (seed ${seed})`);
        const backendResult = await this.backend.generate({
          model: variant.file,
          prompt: engineOut.positive,
          negativePrompt: negative,
          width: size.genWidth,
          height: size.genHeight,
          steps,
          guidance,
          seed,
          output: rawPath,
          loras: lora.ref ? [lora.ref] : undefined,
          sampler: this.config.model.sampler ?? undefined,
          signal: options.signal,
          onProgress: options.onProgress,
        });
        backendMs += backendResult.durationMs;

        const sanity = await sanityCheck(rawPath);
        if (!sanity.ok) {
          rmSync(rawPath, { force: true });
          throw new Error(
            `Generation produced an unusable image (${sanity.issues.join("; ")}). ` +
              `Seed ${seed}, ${size.genWidth}x${size.genHeight}.`,
          );
        }

        // --- upscale ----------------------------------------------------------
        let workingPath = rawPath;
        let upscaled = false;
        let rawDelivered: string | null = null;
        const upscaleMode = options.upscale ?? this.config.upscale.mode;
        // "auto" means *when it would actually help*: only when the delivery
        // size is meaningfully larger than what the model produced. Enlarging
        // a 1024px frame to 1080px is a resample, not an upscale, and running
        // a generative pass for it only risks artefacts.
        const wouldEnlarge =
          size.targetWidth !== undefined && size.targetWidth > size.genWidth * 1.15;
        const shouldUpscale =
          upscaleMode === "final" || (upscaleMode === "auto" && wouldEnlarge);

        if (shouldUpscale) {
          // The model's own frame is kept as a real artifact before anything
          // enlarges it. It is the thing that was actually generated, and no
          // later step may overwrite it — the delivered file always gets its
          // own name. Encoded exactly as delivered but unresized and
          // unfinished, so "raw" means raw.
          rawDelivered = rawSiblingFor(finalPath);
          options.onProgress?.("saving the raw render");
          await finishImage({
            input: rawPath,
            output: rawDelivered,
            quality: this.config.output.quality,
            grain: 0,
            sharpen: 0,
            tone: 0,
          });
          rawFiles.push(rawDelivered);

          const upscaleStart = Date.now();
          const scale = options.upscaleScale ?? this.config.upscale.scale;
          options.onProgress?.(`upscaling ${scale}x (${this.config.upscale.upscaler})`);
          const scaled = join(dirname(finalPath), `.${basename(finalPath)}.up.png`);
          scratch.push(scaled);
          await this.applyUpscale(workingPath, scaled, scale);
          rmSync(workingPath, { force: true });
          workingPath = scaled;
          upscaled = true;
          upscaleMs += Date.now() - upscaleStart;
        }

        // --- finish / encode --------------------------------------------------
        const finishStart = Date.now();
        const wantFinish = options.finish ?? this.config.finish.enabled;
        // A delivery size is a promise about the file on disk, so it is honoured
        // whether or not an upscale ran. Without this, asking for post-portrait
        // with the upscale on quietly delivered 1.5x the generation size.
        const needsResize = size.targetWidth !== undefined;
        const result = await finishImage({
          input: workingPath,
          output: finalPath,
          ...(needsResize ? { width: size.targetWidth!, height: size.targetHeight! } : {}),
          quality: this.config.output.quality,
          grain: wantFinish ? this.config.finish.grain : 0,
          sharpen: wantFinish ? this.config.finish.sharpen : 0,
          tone: wantFinish ? this.config.finish.tone : 0,
        });
        finishMs += Date.now() - finishStart;
        rmSync(workingPath, { force: true });

        files.push(result.file);

        const record: PhotoRecord = {
          schema: 1,
          file: result.file,
          raw_file: rawDelivered,
          prompt_original: options.prompt,
          prompt_enhanced: engineOut.positive,
          negative_prompt: negative,
          preset: options.raw ? "raw" : preset,
          engine: "draw-things-cli",
          model: gen.id,
          model_variant: variant.id,
          lora: lora.manifestId,
          lora_strength: lora.strength,
          seed,
          steps,
          guidance,
          sampler: this.config.model.sampler ?? "model default",
          width: result.width,
          height: result.height,
          gen_width: size.genWidth,
          gen_height: size.genHeight,
          upscaled,
          upscaler: upscaled ? this.config.upscale.upscaler : null,
          upscale_scale: upscaled ? (options.upscaleScale ?? this.config.upscale.scale) : null,
          finished: Boolean(wantFinish),
          created_at: new Date().toISOString(),
          tool_version: toolVersion(),
          rationale: engineOut.rationale,
        };
        records.push(record);

        if (options.metadata ?? this.config.output.metadata) {
          const sidecar = `${finalPath.slice(0, finalPath.length - extname(finalPath).length)}.json`;
          writeFileSync(sidecar, `${JSON.stringify(record, null, 2)}\n`, "utf8");
          metadataFiles.push(sidecar);
        }
      }
    } finally {
      for (const path of scratch) rmSync(path, { force: true });
    }

    return {
      files,
      rawFiles,
      metadataFiles,
      records,
      timings: { totalMs: Date.now() - started, backendMs, upscaleMs, finishMs },
    };
  }

  // -------------------------------------------------------------------------
  // upscale
  // -------------------------------------------------------------------------

  /**
   * Three genuinely different routes, because Draw Things treats them
   * differently:
   *
   *   lanczos              plain resample in-process; invents nothing
   *   esrgan               a built-in upscaler, reachable only via the
   *                        `upscaler` config key, and only at 2x or 4x
   *   generative-restorer  SeedVR2 and friends are *models*, not upscalers —
   *                        they run as an img2img pass at the target size
   *
   * Anything asking for a scale the chosen route cannot do gets finished with
   * a Lanczos step rather than silently returning the wrong size.
   */
  private async applyUpscale(input: string, output: string, scale: number): Promise<void> {
    const upscalerId = this.config.upscale.upscaler;
    const upscaler = upscalerById(upscalerId);
    if (!upscaler) throw new Error(`Unknown upscaler "${upscalerId}".`);
    assertCommerciallyUsable(upscaler);

    const kind = upscaler.kind ?? (upscaler.file ? "generative-restorer" : "lanczos");

    if (kind === "lanczos" || !upscaler.file) {
      await resampleUpscale(input, output, scale, { format: "png" });
      return;
    }

    if (!this.backend.isInstalled(upscaler.file)) {
      throw new Error(
        `Upscaler "${upscaler.name}" is selected but not installed.\n` +
          `Run: local-photo install-upscaler ${upscaler.id}`,
      );
    }

    const { imageSize } = await import("./finish.js");
    const source = await imageSize(input);

    if (kind === "esrgan") {
      // The ESRGAN path runs as a post-pass on a generation, so we drive it
      // through a 1-step img2img at the source size and let Draw Things apply
      // the upscaler afterwards.
      const native = upscaler.scale ?? 2;
      const staging = `${output}.esrgan.png`;
      await this.backend.generate({
        model: activeVariant(this.config).file,
        prompt: "",
        width: Math.round(source.width / 64) * 64,
        height: Math.round(source.height / 64) * 64,
        steps: 1,
        guidance: 1,
        seed: 0,
        image: input,
        strength: 0.02,
        output: staging,
        configOverrides: { upscaler: upscaler.file, upscalerScaleFactor: native },
      });
      // Native factor rarely equals the requested factor; correct optically.
      const staged = await imageSize(staging);
      const wanted = Math.round(source.width * scale);
      if (Math.abs(staged.width - wanted) > 8) {
        await finishImage({
          input: staging,
          output,
          width: wanted,
          height: Math.round(source.height * scale),
          format: "png",
          fit: "inside",
          grain: 0,
          sharpen: 0,
        });
        rmSync(staging, { force: true });
      } else {
        renameSync(staging, output);
      }
      return;
    }

    // Generative restorers take the target size directly.
    await this.backend.generate({
      model: upscaler.file,
      prompt: "",
      width: Math.round((source.width * scale) / 64) * 64,
      height: Math.round((source.height * scale) / 64) * 64,
      steps: 1,
      guidance: 1,
      seed: 0,
      image: input,
      strength: 1,
      output,
    });
  }

  async upscale(options: UpscaleOptions): Promise<PhotoResult> {
    const started = Date.now();
    const input = isAbsolute(options.input) ? options.input : resolve(this.cwd, options.input);
    if (!existsSync(input)) throw new Error(`No such file: ${input}`);

    const scale = options.scale ?? this.config.upscale.scale;
    const previousUpscaler = this.config.upscale.upscaler;
    if (options.upscaler) this.config.upscale.upscaler = options.upscaler;

    const ext = extname(input);
    const target =
      options.output
        ? isAbsolute(options.output) ? options.output : resolve(this.cwd, options.output)
        : `${input.slice(0, input.length - ext.length)}@${scale}x.${this.config.output.format}`;
    ensureDir(dirname(target));

    const temp = join(dirname(target), `.${basename(target)}.up.png`);
    try {
      await this.applyUpscale(input, temp, scale);
      const result = await finishImage({
        input: temp,
        output: target,
        quality: this.config.output.quality,
        grain: 0,
        sharpen: options.finish ? this.config.finish.sharpen : 0,
        tone: 0,
      });
      rmSync(temp, { force: true });

      return {
        files: [result.file],
        rawFiles: [],
        metadataFiles: [],
        records: [],
        timings: { totalMs: Date.now() - started, backendMs: 0, upscaleMs: Date.now() - started },
      };
    } finally {
      this.config.upscale.upscaler = previousUpscaler;
      rmSync(temp, { force: true });
    }
  }
}

/** Reproduce a photograph from its sidecar. */
export async function reproduce(
  recordPath: string,
  options: { output?: string; cwd?: string } = {},
): Promise<PhotoResult> {
  const { readFileSync } = await import("node:fs");
  const record = JSON.parse(readFileSync(recordPath, "utf8")) as PhotoRecord;
  const config = loadConfig();

  config.model.variant = record.model_variant;
  config.model.steps = record.steps;
  config.model.guidance = record.guidance;
  config.lora.id = record.lora;
  config.lora.enabled = Boolean(record.lora);
  if (record.lora_strength !== null) config.lora.strength = record.lora_strength;
  // Replay the upscale that was actually used, not whatever the config says
  // today. Otherwise a photograph made at 2x with a different upscaler comes
  // back at the current default and is not a reproduction of anything.
  if (record.upscaled && record.upscaler) config.upscale.upscaler = record.upscaler;

  const service = new LocalPhotoService({ config, cwd: options.cwd });
  return service.generate({
    // The enhanced prompt is replayed verbatim: re-running the engine would be
    // a different experiment, not a reproduction.
    prompt: record.prompt_enhanced,
    raw: true,
    ...(record.negative_prompt ? { negativePrompt: record.negative_prompt } : {}),
    seed: record.seed,
    steps: record.steps,
    guidance: record.guidance,
    // Replay the generation size, not the delivery size.
    width: record.gen_width ?? record.width,
    height: record.gen_height ?? record.height,
    upscale: record.upscaled ? "final" : "off",
    // `!= null` on purpose: sidecars written before this field existed have no
    // key at all, and those must fall through to the configured scale.
    ...(record.upscaled && record.upscale_scale != null
      ? { upscaleScale: record.upscale_scale }
      : {}),
    output: options.output ?? undefined,
  });
}

