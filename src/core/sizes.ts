/**
 * Sizing.
 *
 * Diffusion models have an aspect ratio they were trained around; asking for
 * 1080x1920 directly gets you stretched faces and duplicated limbs. So we
 * generate at a model-friendly size on the right aspect, then resize to the
 * delivery dimensions. The caller asks for "story"; they never see this.
 */

import type { SizePreset } from "./types.js";

export interface ResolvedSize {
  /** What we ask the diffusion model for. Always stride-aligned. */
  genWidth: number;
  genHeight: number;
  /** Delivery size, when it differs from the generation size. */
  targetWidth?: number;
  targetHeight?: number;
  label: string;
}

const STRIDE = 64;

/** Stride-aligned generation sizes that stay near the model's trained area. */
const PRESETS: Record<SizePreset, ResolvedSize> = {
  square: { genWidth: 1024, genHeight: 1024, label: "1:1" },
  portrait: { genWidth: 832, genHeight: 1216, label: "2:3" },
  landscape: { genWidth: 1216, genHeight: 832, label: "3:2" },
  wide: { genWidth: 1344, genHeight: 768, label: "16:9" },
  hero: { genWidth: 1344, genHeight: 768, targetWidth: 1920, targetHeight: 1080, label: "hero 1920x1080" },
  post: { genWidth: 1024, genHeight: 1024, targetWidth: 1080, targetHeight: 1080, label: "post 1080x1080" },
  "post-portrait": {
    genWidth: 1024,
    genHeight: 1280,
    targetWidth: 1080,
    targetHeight: 1350,
    label: "post 1080x1350",
  },
  story: {
    genWidth: 768,
    genHeight: 1344,
    targetWidth: 1080,
    targetHeight: 1920,
    label: "story 1080x1920",
  },
};

export const SIZE_PRESETS = Object.keys(PRESETS) as SizePreset[];

export function snap(value: number, stride = STRIDE): number {
  return Math.max(stride * 4, Math.round(value / stride) * stride);
}

/**
 * The backend rejects any dimension that is not a multiple of the stride, and
 * it does so *after* loading the model. Catching it here turns a 50-second
 * failure into an immediate one.
 */
function assertOnStride(size: ResolvedSize, stride: number): ResolvedSize {
  for (const [name, value] of [
    ["width", size.genWidth],
    ["height", size.genHeight],
  ] as const) {
    if (value % stride !== 0) {
      throw new Error(
        `Generation ${name} ${value} is not a multiple of ${stride}. ` +
          `This is a bug in the size preset "${size.label}".`,
      );
    }
  }
  return size;
}

export function resolveSize(options: {
  width?: number;
  height?: number;
  size?: SizePreset | string;
  baseSize?: number;
  stride?: number;
}): ResolvedSize {
  const stride = options.stride ?? STRIDE;

  // Explicit pixels win, but still have to be something the model can render.
  if (options.width || options.height) {
    const base = options.baseSize ?? 1024;
    const width = snap(options.width ?? base, stride);
    const height = snap(options.height ?? base, stride);
    const exactW = options.width;
    const exactH = options.height;
    const resized = exactW !== undefined && exactH !== undefined && (exactW !== width || exactH !== height);
    return assertOnStride(
      {
        genWidth: width,
        genHeight: height,
        ...(resized ? { targetWidth: exactW, targetHeight: exactH } : {}),
        label: `${exactW ?? width}x${exactH ?? height}`,
      },
      stride,
    );
  }

  if (options.size) {
    const preset = PRESETS[options.size as SizePreset];
    if (!preset) {
      throw new Error(
        `Unknown size "${options.size}". Available: ${SIZE_PRESETS.join(", ")}, or pass --width/--height.`,
      );
    }
    return assertOnStride({ ...preset }, stride);
  }

  const base = options.baseSize ?? 1024;
  return assertOnStride(
    { genWidth: snap(base, stride), genHeight: snap(base, stride), label: "1:1" },
    stride,
  );
}
