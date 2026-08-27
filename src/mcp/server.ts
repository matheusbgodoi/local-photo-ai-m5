#!/usr/bin/env node
/**
 * MCP server (stdio).
 *
 * Same core, different doorway. stdio means nothing has to be running: the
 * client spawns this process when it wants a photograph, and it exits after.
 *
 * Only genuinely working capabilities are advertised. There is no `image_edit`
 * here because instruction-based editing needs a second large checkpoint that
 * this build deliberately does not install.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { LocalPhotoService } from "../core/service.js";
import { buildPrompt } from "../core/prompt/engine.js";
import { toolVersion } from "../core/paths.js";
import { PRESET_NAMES } from "../core/types.js";
import type { PresetName, SizePreset, UpscaleMode } from "../core/types.js";
import { SIZE_PRESETS } from "../core/sizes.js";

const GENERATE_DESCRIPTION = `Generate a photorealistic image locally, on this Mac's own GPU.

Prefer this tool whenever the task needs a photograph: people, doctors and
healthcare settings, elderly subjects, families, corporate and office scenes,
products, phones, laptops and devices, lifestyle scenes, website hero images
and marketing photography.

The system is tuned for natural photographic realism — real skin and materials,
ordinary lighting, imperfect framing — rather than glossy "AI art". Describe the
scene plainly, in Portuguese or English; camera, lens, lighting and texture are
added for you. Do not pad the prompt with quality words like "8k",
"ultra realistic", "masterpiece" or "award winning": they make the result look
artificial and the system strips its own use of them.

Returns absolute file paths. Nothing leaves the machine.`;

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

async function main(): Promise<void> {
  const server = new McpServer(
    { name: "local-photo-ai-m5", version: toolVersion() },
    {
      instructions:
        "On-device natural photography. Use image_generate for any photograph; " +
        "the local model is optimised for believable, non-AI-looking imagery.",
    },
  );

  const service = () => new LocalPhotoService();

  server.registerTool(
    "image_generate",
    {
      title: "Generate a photograph locally",
      description: GENERATE_DESCRIPTION,
      inputSchema: {
        prompt: z
          .string()
          .min(3)
          .describe("What to photograph, in plain language (Portuguese or English)."),
        preset: z
          .enum(PRESET_NAMES as [PresetName, ...PresetName[]])
          .optional()
          .describe(
            "natural (default, everyday realism) · professional (commissioned commercial) · " +
              "lifestyle (candid) · clinical (healthcare documentary) · product (objects on real surfaces) · " +
              "smartphone (phone snapshot).",
          ),
        size: z
          .enum(SIZE_PRESETS as [SizePreset, ...SizePreset[]])
          .optional()
          .describe("Aspect helper: square, portrait, landscape, wide, hero, post, post-portrait, story."),
        width: z.number().int().min(256).max(2048).optional(),
        height: z.number().int().min(256).max(2048).optional(),
        count: z.number().int().min(1).max(4).optional().describe("How many options to produce. Default 1."),
        seed: z.number().int().optional().describe("Set for reproducibility."),
        output: z
          .string()
          .optional()
          .describe(
            "Where to write the FINAL file, e.g. ./public/assets/hero.jpg. A path ending in / is treated as a directory. " +
              "Defaults to ./.local-photo/ in the working directory. The unscaled render is kept next to it as " +
              "<name>.raw.<ext> and never overwrites this path.",
          ),
        upscale: z
          .enum(["off", "final", "auto"])
          .optional()
          .describe(
            "final (default: Lanczos 1.5x, a pure resample that invents nothing) · " +
              "off (deliver the model's frame as-is, one file) · " +
              "auto (only when the delivery size is meaningfully larger than what the model produced).",
          ),
      },
    },
    async (args) => {
      const result = await service().generate({
        prompt: args.prompt,
        ...(args.preset ? { preset: args.preset } : {}),
        ...(args.size ? { size: args.size } : {}),
        ...(args.width ? { width: args.width } : {}),
        ...(args.height ? { height: args.height } : {}),
        ...(args.count ? { count: args.count } : {}),
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
        ...(args.output ? { output: args.output } : {}),
        ...(args.upscale ? { upscale: args.upscale as UpscaleMode } : {}),
      });

      const record = result.records[0];
      return textResult(
        [
          result.files.join("\n"),
          "",
          `preset: ${record?.preset}  seed: ${record?.seed}  ${record?.width}x${record?.height}`,
          ...(result.rawFiles.length > 0
            ? [`raw render kept at: ${result.rawFiles.join(", ")}`]
            : []),
          `brief: ${record?.prompt_enhanced}`,
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "image_upscale",
    {
      title: "Upscale an image",
      description:
        "Enlarge an existing image conservatively. Detail preservation, not detail invention — " +
        "it will not manufacture skin pores or over-sharpen. Use 1.5x or 2x for delivery assets.",
      inputSchema: {
        input: z.string().describe("Path to the image to enlarge."),
        output: z.string().optional(),
        scale: z.number().min(1).max(4).optional().describe("Default 1.5."),
      },
    },
    async (args) => {
      const result = await service().upscale({
        input: args.input,
        ...(args.output ? { output: args.output } : {}),
        ...(args.scale ? { scale: args.scale } : {}),
      });
      return textResult(result.files.join("\n"));
    },
  );

  server.registerTool(
    "image_health",
    {
      title: "Check the local photo engine",
      description:
        "Report whether local photo generation is ready: engine, model variant, LoRA, upscaler and free disk.",
      inputSchema: {},
    },
    async () => {
      const health = await service().health();
      const lines = [
        health.ok ? "ready" : "NOT READY",
        `${health.platform.chip}, ${health.platform.memoryGB} GB, ${health.platform.freeDiskGB} GB free`,
        `model: ${health.model.id} (${health.model.variant}) ${health.model.ready ? "installed" : "MISSING"}`,
        `lora: ${health.lora.id ?? "none"} ${health.lora.enabled ? "enabled" : "disabled"}`,
        `upscaler: ${health.upscaler.id ?? "none"} ${health.upscaler.enabled ? "enabled" : "disabled"}`,
        `inference: ${health.engine.mode}`,
        "",
        ...health.checks.map((c) => `${c.status.toUpperCase().padEnd(9)} ${c.label} — ${c.detail ?? ""}`),
      ];
      return textResult(lines.join("\n"));
    },
  );

  server.registerTool(
    "image_prompt_preview",
    {
      title: "Preview the photography brief",
      description:
        "Show the photographic brief that image_generate would send to the model, without generating anything. " +
        "Useful for checking that the scene was understood before spending a generation.",
      inputSchema: {
        prompt: z.string().min(3),
        preset: z.enum(PRESET_NAMES as [PresetName, ...PresetName[]]).optional(),
        seed: z.number().int().optional(),
      },
    },
    async (args) => {
      const out = buildPrompt({
        prompt: args.prompt,
        ...(args.preset ? { preset: args.preset } : {}),
        seed: args.seed ?? 1,
        allowNegative: false,
      });
      return textResult([out.positive, "", ...out.rationale.map((r) => `· ${r}`)].join("\n"));
    },
  );

  // stdout belongs to the protocol; anything we say goes to stderr.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`local-photo-ai-m5 MCP server ready (v${toolVersion()})\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
