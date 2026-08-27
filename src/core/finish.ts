/**
 * Simple photo finish — the non-generative pass.
 *
 * Everything here is optical, not inventive: resize, encode, a whisper of
 * luminance grain, a touch of capture sharpening. No clarity, no HDR, no
 * vignette, no film emulation. If you cannot tell it ran, it was set correctly.
 *
 * It exists mostly to do the *boring* things right: resize with a decent
 * kernel, tag sRGB, and encode at a quality that does not smear skin.
 */

import { randomBytes } from "node:crypto";
import { dirname, extname } from "node:path";
import sharp from "sharp";
import { ensureDir } from "./paths.js";

export type OutputFormat = "jpg" | "jpeg" | "png" | "webp";

export interface FinishOptions {
  input: string;
  output: string;
  width?: number;
  height?: number;
  format?: OutputFormat;
  quality?: number;
  /** 0..1. Luminance grain amount; 0 disables. */
  grain?: number;
  /** 0..1. Capture sharpening; 0 disables. */
  sharpen?: number;
  /** 0..1. Mild S-curve on the tone response; 0 disables. */
  tone?: number;
  /** Resize behaviour when the aspect differs. */
  fit?: "cover" | "contain" | "inside";
}

export interface FinishResult {
  file: string;
  width: number;
  height: number;
  bytes: number;
  applied: string[];
}

function formatOf(path: string, explicit?: OutputFormat): OutputFormat {
  if (explicit) return explicit;
  const ext = extname(path).toLowerCase().replace(".", "");
  if (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp") return ext;
  return "jpg";
}

/**
 * Monochrome grain, generated once per call.
 *
 * Grain has to be luminance-only: coloured noise reads as sensor failure, not
 * as film. It is composited in `overlay` so mid-tones move and clipped
 * highlights stay clipped.
 *
 * Calibrated by eye at 100 %: 0.2 reads as sensor character, 0.3 is visible,
 * and 0.45 is plainly noisy on a smooth wall. The shipped default is 0.2.
 */
async function grainLayer(width: number, height: number, amount: number): Promise<Buffer> {
  const pixels = width * height;
  const noise = randomBytes(pixels);
  const spread = Math.max(1, Math.round(38 * amount));
  for (let i = 0; i < pixels; i++) {
    // Re-centre the byte around mid-grey so `overlay` is a no-op at amount 0.
    noise[i] = 128 + Math.round(((noise[i]! - 128) / 128) * spread);
  }
  return sharp(noise, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

export async function finishImage(options: FinishOptions): Promise<FinishResult> {
  const applied: string[] = [];
  const format = formatOf(options.output, options.format);
  const quality = options.quality ?? 92;

  ensureDir(dirname(options.output));

  let pipeline = sharp(options.input, { failOn: "error" });
  const meta = await pipeline.metadata();

  if (options.width || options.height) {
    pipeline = pipeline.resize({
      width: options.width,
      height: options.height,
      fit: options.fit ?? "cover",
      position: "attention",
      kernel: "lanczos3",
      withoutEnlargement: false,
    });
    applied.push(`resize ${options.width ?? "auto"}x${options.height ?? "auto"} (lanczos3)`);
  }

  // Tone: a very shallow S-curve. Gamma below 1 lifts, above 1 deepens; we use
  // a small linear contrast instead so shadows do not get crushed.
  if (options.tone && options.tone > 0) {
    const strength = Math.min(1, options.tone);
    pipeline = pipeline.linear(1 + 0.06 * strength, -(0.06 * strength * 8));
    applied.push(`tone ${strength.toFixed(2)}`);
  }

  if (options.sharpen && options.sharpen > 0) {
    const strength = Math.min(1, options.sharpen);
    // Capture sharpening: small radius, low amount, high threshold so skin and
    // gradients are left alone and only real edges move.
    pipeline = pipeline.sharpen({ sigma: 0.6, m1: 0.4 * strength, m2: 0.25 * strength, x1: 3 });
    applied.push(`sharpen ${strength.toFixed(2)} (capture-level)`);
  }

  let buffer = await pipeline.toColourspace("srgb").toBuffer({ resolveWithObject: true });

  if (options.grain && options.grain > 0) {
    const amount = Math.min(1, options.grain);
    const noise = await grainLayer(buffer.info.width, buffer.info.height, amount * 0.5);
    buffer = await sharp(buffer.data)
      .composite([{ input: noise, blend: "overlay" }])
      .toBuffer({ resolveWithObject: true });
    applied.push(`grain ${amount.toFixed(2)} (luminance only)`);
  }

  let out = sharp(buffer.data).withMetadata({ icc: "srgb" });
  if (format === "png") out = out.png({ compressionLevel: 9 });
  else if (format === "webp") out = out.webp({ quality, effort: 5 });
  else out = out.jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: true });

  const info = await out.toFile(options.output);
  applied.push(`encode ${format} q${quality}`);

  return {
    file: options.output,
    width: info.width,
    height: info.height,
    bytes: info.size,
    applied: applied.length > 0 ? applied : [`copy (${meta.width}x${meta.height})`],
  };
}

/** Pure Lanczos enlargement, no invention. The conservative upscale path. */
export async function resampleUpscale(
  input: string,
  output: string,
  scale: number,
  options: { format?: OutputFormat; quality?: number } = {},
): Promise<FinishResult> {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error(`Cannot read image dimensions: ${input}`);
  return finishImage({
    input,
    output,
    width: Math.round(meta.width * scale),
    height: Math.round(meta.height * scale),
    fit: "inside",
    grain: 0,
    sharpen: 0.2,
    tone: 0,
    ...options,
  });
}

export async function imageSize(path: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(path).metadata();
  if (!meta.width || !meta.height) throw new Error(`Cannot read image dimensions: ${path}`);
  return { width: meta.width, height: meta.height };
}

/**
 * Cheap sanity checks. Catches the failures that actually happen locally:
 * a truncated write, an all-black frame, or a uniform grey canvas.
 */
export interface SanityReport {
  ok: boolean;
  issues: string[];
  meanLuma: number;
  stdDev: number;
}

export async function sanityCheck(path: string): Promise<SanityReport> {
  const issues: string[] = [];
  const stats = await sharp(path).greyscale().stats();
  const channel = stats.channels[0]!;
  const mean = channel.mean;
  const stdev = channel.stdev;

  if (mean < 2) issues.push("image is essentially black");
  if (mean > 253) issues.push("image is essentially white");
  if (stdev < 2) issues.push("image is a flat, featureless field");

  return { ok: issues.length === 0, issues, meanLuma: mean, stdDev: stdev };
}
