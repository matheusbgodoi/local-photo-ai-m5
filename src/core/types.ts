/**
 * Public contracts for local-photo-ai-m5.
 *
 * The agent-facing surface (CLI, Pi extension, MCP server) only ever speaks in
 * these terms. Nothing here mentions checkpoints, samplers, Metal or
 * quantisation — picking those is the service's job, not the caller's.
 */

export type PresetName =
  | "natural"
  | "professional"
  | "lifestyle"
  | "clinical"
  | "product"
  | "smartphone";

export const PRESET_NAMES: PresetName[] = [
  "natural",
  "professional",
  "lifestyle",
  "clinical",
  "product",
  "smartphone",
];

export type UpscaleMode = "off" | "final" | "auto";

/** Social/web aspect helpers. Diffusion still runs at a model-friendly size. */
export type SizePreset =
  | "square"
  | "portrait"
  | "landscape"
  | "wide"
  | "story"
  | "post"
  | "post-portrait"
  | "hero";

export interface GenerateOptions {
  /** Plain-language intent, in Portuguese or English. Never rewritten semantically. */
  prompt: string;
  preset?: PresetName;
  /** Explicit pixel size. Overrides `size`. Snapped to the model's stride. */
  width?: number;
  height?: number;
  /** Named aspect helper. */
  size?: SizePreset;
  /** Deterministic seed. Omitted -> random, and the value used is recorded. */
  seed?: number;
  /** Sampling steps. Omitted -> the model variant's tuned default. */
  steps?: number;
  /** Classifier-free guidance. Omitted -> the model variant's tuned default. */
  guidance?: number;
  /** How many images to produce. Default 1. */
  count?: number;
  /** Absolute or relative output path (file for count=1, else a stem). */
  output?: string;
  /** Force a LoRA on/off for this call, overriding config. */
  lora?: string | false;
  loraStrength?: number;
  upscale?: UpscaleMode;
  upscaleScale?: number;
  /** Non-generative finishing pass (grain, tone, resize, encode). */
  finish?: boolean;
  /** Skip the photography prompt engine and pass the prompt through verbatim. */
  raw?: boolean;
  /** Write the sidecar <name>.json. Default true. */
  metadata?: boolean;
  /** Negative prompt override. Ignored when the model runs distilled (cfg 1). */
  negativePrompt?: string;
  /** Extra deterministic context the caller already knows (never invented). */
  hints?: SceneHints;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

/**
 * Facts the caller already knows about the scene. The prompt engine may use
 * these to pick camera/lighting language, but it never invents them.
 */
export interface SceneHints {
  aspect?: string;
  /** e.g. "hero image", "instagram post" — affects framing headroom only. */
  usage?: string;
}

export interface PhotoResult {
  /** Absolute paths of every delivered image, in order. The main artifacts. */
  files: string[];
  /**
   * Absolute paths of the unscaled renders kept alongside them, in order.
   * Empty when nothing was upscaled, because then `files` already *is* the raw
   * render. Never overwritten by, and never the same path as, `files`.
   */
  rawFiles: string[];
  /** Absolute paths of the sidecar metadata files, when written. */
  metadataFiles: string[];
  records: PhotoRecord[];
  timings: Timings;
}

export interface Timings {
  totalMs: number;
  /** Wall time of the backend process(es), including model load on cold start. */
  backendMs: number;
  upscaleMs?: number;
  finishMs?: number;
}

/** The reproducibility sidecar written next to every image. */
export interface PhotoRecord {
  schema: 1;
  /** Absolute path of the delivered image — the main artifact. */
  file: string;
  /**
   * Absolute path of the unscaled render kept next to it, or null when the
   * delivered file is itself the raw render (upscale off).
   */
  raw_file?: string | null;
  prompt_original: string;
  prompt_enhanced: string;
  negative_prompt: string | null;
  preset: PresetName | "raw";
  engine: string;
  model: string;
  model_variant: string;
  lora: string | null;
  lora_strength: number | null;
  seed: number;
  steps: number;
  guidance: number;
  sampler: string;
  /** Delivery dimensions of the file on disk. */
  width: number;
  height: number;
  /**
   * What the model was actually asked for. Differs from width/height whenever
   * a size preset resamples to delivery dimensions, and it is this pair that
   * has to be replayed to reproduce the generation.
   */
  gen_width: number;
  gen_height: number;
  upscaled: boolean;
  upscaler: string | null;
  upscale_scale: number | null;
  finished: boolean;
  created_at: string;
  tool_version: string;
  /** Why the engine wrote what it wrote — auditable, not decorative. */
  rationale?: string[];
}

export interface UpscaleOptions {
  input: string;
  output?: string;
  scale?: number;
  /** Force a specific upscaler id from the manifest. */
  upscaler?: string;
  finish?: boolean;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface EditOptions {
  input: string;
  prompt: string;
  preset?: PresetName;
  strength?: number;
  seed?: number;
  output?: string;
  signal?: AbortSignal;
}

export type CheckStatus = "ok" | "warn" | "fail" | "disabled";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  hint?: string;
}

export interface HealthResult {
  ok: boolean;
  checks: Check[];
  platform: {
    os: string;
    chip: string;
    memoryGB: number;
    freeDiskGB: number;
  };
  engine: {
    name: string;
    version: string | null;
    mode: "on-demand" | "warm";
  };
  model: {
    id: string | null;
    variant: string | null;
    ready: boolean;
  };
  lora: {
    id: string | null;
    enabled: boolean;
    commercialUseVerified: boolean | null;
  };
  upscaler: {
    id: string | null;
    enabled: boolean;
  };
}

/**
 * The one abstraction every front-end talks to.
 *
 * `edit` is intentionally optional: it is only present when the installed
 * backend can actually do image-to-image reliably. We do not advertise
 * capabilities we cannot deliver.
 */
export interface PhotoService {
  health(): Promise<HealthResult>;
  generate(options: GenerateOptions): Promise<PhotoResult>;
  upscale(options: UpscaleOptions): Promise<PhotoResult>;
  edit?(options: EditOptions): Promise<PhotoResult>;
}
