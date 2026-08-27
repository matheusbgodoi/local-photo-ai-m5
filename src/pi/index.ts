/**
 * Pi extension.
 *
 * Pi has no built-in MCP client, so this is a native extension rather than a
 * bridge — but it calls the exact same core the MCP server and the CLI call.
 * One implementation, three doorways.
 *
 * Installed globally at ~/.pi/agent/extensions/local-photo/, so the tools are
 * available in every repo without per-project setup.
 */

import { readFileSync } from "node:fs";
import { Type } from "typebox";

import { LocalPhotoService } from "../core/service.js";
import { buildPrompt } from "../core/prompt/engine.js";
import { PRESET_NAMES } from "../core/types.js";
import type { PresetName, SizePreset, UpscaleMode } from "../core/types.js";
import { SIZE_PRESETS } from "../core/sizes.js";

/**
 * Pi's own types are a peer concern; importing them would make this file
 * unbuildable outside a Pi checkout. The shapes we rely on are small and
 * stable, so we describe them structurally.
 */
interface ToolResultContent {
  type: string;
  text?: string;
  source?: { type: "base64"; mediaType: string; data: string };
}
interface ToolResult {
  content: ToolResultContent[];
  details?: unknown;
}
interface PiApi {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters: unknown;
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: ((update: ToolResult) => void) | undefined,
      ctx: { cwd: string },
    ) => Promise<ToolResult>;
  }): void;
}

const GENERATE_DESCRIPTION = `Generate a photorealistic image locally, on this Mac's GPU.

Prefer this tool for anything that should look like a photograph: people,
doctors and clinical settings, elderly subjects, families, corporate and office
scenes, products, phones, laptops, medical devices, lifestyle scenes, website
hero images and marketing photography.

The system is tuned for natural photographic realism — believable skin and
materials, ordinary lighting, slightly imperfect framing — not glossy "AI art".
Describe the scene plainly in Portuguese or English. Camera, lens, lighting and
texture language are written for you; do NOT add quality words like "8k",
"ultra realistic", "masterpiece" or "award winning", which make output look
artificial.

Returns absolute file paths. Everything runs offline on this machine.`;

const text = (value: string): ToolResultContent => ({ type: "text", text: value });

function imageContent(path: string): ToolResultContent {
  const data = readFileSync(path).toString("base64");
  const mediaType = path.endsWith(".png")
    ? "image/png"
    : path.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  return { type: "image", source: { type: "base64", mediaType, data } };
}

const generateParams = Type.Object({
  prompt: Type.String({
    description: "What to photograph, in plain language (Portuguese or English).",
  }),
  preset: Type.Optional(
    Type.String({
      description:
        "natural (default) | professional | lifestyle | clinical | product | smartphone",
      enum: PRESET_NAMES as unknown as string[],
    }),
  ),
  size: Type.Optional(
    Type.String({
      description: "square | portrait | landscape | wide | hero | post | post-portrait | story",
      enum: SIZE_PRESETS as unknown as string[],
    }),
  ),
  width: Type.Optional(Type.Number({ description: "Explicit width in pixels." })),
  height: Type.Optional(Type.Number({ description: "Explicit height in pixels." })),
  count: Type.Optional(Type.Number({ description: "How many options to produce (1-4). Default 1." })),
  seed: Type.Optional(Type.Number({ description: "Seed, for reproducible results." })),
  output: Type.Optional(
    Type.String({
      description:
        "Destination of the FINAL file, e.g. ./public/assets/hero.jpg. A trailing / means a directory. " +
        "Defaults to ./.local-photo/ under the current working directory. The unscaled render is kept " +
        "beside it as <name>.raw.<ext> and never overwrites this path.",
    }),
  ),
  upscale: Type.Optional(
    Type.String({
      description:
        "final (default: Lanczos 1.5x, invents nothing) | off (deliver the model's frame alone) | " +
        "auto (only when the delivery size is meaningfully larger than the frame).",
      enum: ["off", "final", "auto"],
    }),
  ),
  preview: Type.Optional(
    Type.Boolean({ description: "Also return the image inline so you can look at it. Default false." }),
  ),
});

const upscaleParams = Type.Object({
  input: Type.String({ description: "Path of the image to enlarge." }),
  output: Type.Optional(Type.String()),
  scale: Type.Optional(Type.Number({ description: "1.5 or 2 are the useful range. Default 1.5." })),
});

const previewParams = Type.Object({
  prompt: Type.String(),
  preset: Type.Optional(Type.String({ enum: PRESET_NAMES as unknown as string[] })),
  seed: Type.Optional(Type.Number()),
});

export default function localPhoto(pi: PiApi): void {
  const registerGenerate = (name: string) =>
    pi.registerTool({
      name,
      label: "Photo",
      description: GENERATE_DESCRIPTION,
      promptSnippet: "Generate a natural, photorealistic image locally (people, products, clinics, hero shots)",
      promptGuidelines: [
        `Use ${name} instead of describing a placeholder image or linking to a stock photo site.`,
        `When writing prompts for ${name}, state the scene plainly and let it handle camera, lighting and texture.`,
      ],
      parameters: generateParams,
      execute: async (_id, params, signal, onUpdate, ctx) => {
        const service = new LocalPhotoService({ cwd: ctx.cwd });
        const result = await service.generate({
          prompt: String(params.prompt),
          ...(params.preset ? { preset: params.preset as PresetName } : {}),
          ...(params.size ? { size: params.size as SizePreset } : {}),
          ...(params.width ? { width: Number(params.width) } : {}),
          ...(params.height ? { height: Number(params.height) } : {}),
          ...(params.count ? { count: Number(params.count) } : {}),
          ...(params.seed !== undefined ? { seed: Number(params.seed) } : {}),
          ...(params.output ? { output: String(params.output) } : {}),
          ...(params.upscale ? { upscale: params.upscale as UpscaleMode } : {}),
          ...(signal ? { signal } : {}),
          onProgress: (message: string) => onUpdate?.({ content: [text(message)] }),
        });

        const record = result.records[0];
        const content: ToolResultContent[] = [
          text(
            [
              result.files.join("\n"),
              "",
              `preset ${record?.preset} · seed ${record?.seed} · ${record?.width}x${record?.height} · ` +
                `${Math.round(result.timings.totalMs / 100) / 10}s`,
              ...(result.rawFiles.length > 0
                ? [`raw render kept at ${result.rawFiles.join(", ")}`]
                : []),
              `brief: ${record?.prompt_enhanced}`,
            ].join("\n"),
          ),
        ];
        if (params.preview) {
          for (const file of result.files) content.push(imageContent(file));
        }
        return { content, details: { files: result.files, records: result.records } };
      },
    });

  const registerUpscale = (name: string) =>
    pi.registerTool({
      name,
      label: "Upscale",
      description:
        "Enlarge an existing image conservatively — preserves detail without inventing pores or over-sharpening. " +
        "Use 1.5x or 2x when preparing a final asset; skip it during development.",
      parameters: upscaleParams,
      execute: async (_id, params, signal, _onUpdate, ctx) => {
        const service = new LocalPhotoService({ cwd: ctx.cwd });
        const result = await service.upscale({
          input: String(params.input),
          ...(params.output ? { output: String(params.output) } : {}),
          ...(params.scale ? { scale: Number(params.scale) } : {}),
          ...(signal ? { signal } : {}),
        });
        return { content: [text(result.files.join("\n"))], details: { files: result.files } };
      },
    });

  const registerHealth = (name: string) =>
    pi.registerTool({
      name,
      label: "Photo health",
      description:
        "Check whether local photo generation is ready on this machine: engine, model variant, LoRA, upscaler, disk.",
      parameters: Type.Object({}),
      execute: async () => {
        const health = await new LocalPhotoService().health();
        return {
          content: [
            text(
              [
                health.ok ? "ready" : "NOT READY",
                `${health.platform.chip}, ${health.platform.memoryGB} GB, ${health.platform.freeDiskGB} GB free`,
                `model ${health.model.id} (${health.model.variant}) ${health.model.ready ? "installed" : "MISSING"}`,
                `lora ${health.lora.id ?? "none"} ${health.lora.enabled ? "enabled" : "disabled"}`,
                `upscaler ${health.upscaler.id ?? "none"} ${health.upscaler.enabled ? "enabled" : "disabled"}`,
                "",
                ...health.checks.map((c) => `${c.status.toUpperCase().padEnd(9)} ${c.label} — ${c.detail ?? ""}`),
              ].join("\n"),
            ),
          ],
          details: health,
        };
      },
    });

  registerGenerate("image_generate");
  registerUpscale("image_upscale");
  registerHealth("image_health");

  pi.registerTool({
    name: "image_prompt_preview",
    label: "Photo brief",
    description:
      "Show the photographic brief image_generate would use, without generating. " +
      "Cheap way to confirm the scene was understood before spending a generation.",
    parameters: previewParams,
    execute: async (_id, params) => {
      const out = buildPrompt({
        prompt: String(params.prompt),
        ...(params.preset ? { preset: params.preset as PresetName } : {}),
        seed: params.seed !== undefined ? Number(params.seed) : 1,
        allowNegative: false,
      });
      return {
        content: [text([out.positive, "", ...out.rationale.map((r) => `· ${r}`)].join("\n"))],
        details: out,
      };
    },
  });

  // Some agents reach for photo_* first. Opt-in so the default tool list stays small.
  if (process.env.LOCAL_PHOTO_TOOL_ALIASES === "1") {
    registerGenerate("photo_generate");
    registerUpscale("photo_upscale");
    registerHealth("photo_health");
  }
}
