#!/usr/bin/env node
/**
 * local-photo — the command line front-end.
 *
 * Deliberately thin. Every command is argument parsing plus one call into the
 * core, so the CLI, the Pi extension and the MCP server cannot drift apart.
 */

import { parseArgs } from "node:util";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { LocalPhotoService, reproduce } from "../core/service.js";
import { DrawThingsBackend } from "../core/backend/drawthings.js";
import {
  activeVariant,
  generator,
  loadConfig,
  loadManifest,
  loraById,
  saveUserConfig,
  upscalerById,
} from "../core/config.js";
import { buildPrompt } from "../core/prompt/engine.js";
import { PRESETS } from "../core/prompt/presets.js";
import { SIZE_PRESETS } from "../core/sizes.js";
import { modelsDir, repoRoot, stateDir, toolVersion, logsDir } from "../core/paths.js";
import { run } from "../core/exec.js";
import { installLora, installUpscaler, listLoraStatus } from "../core/lora.js";
import { runBenchmark, formatBenchmark } from "../core/benchmark.js";
import { renderHtml } from "../render/html.js";
import { probeWarmServer, DEFAULT_HTTP_PORT } from "../core/warm.js";
import { prunableWeights, verifyIntegrity } from "../core/verify.js";
import {
  PRESET_NAMES,
  type PhotoRecord,
  type PresetName,
  type SizePreset,
  type UpscaleMode,
} from "../core/types.js";
import * as ui from "./ui.js";

const USAGE = `local-photo — on-device natural photography (Draw Things + Z-Image Turbo)

USAGE
  local-photo <command> [options]
  local-photo <command> --help        Detailed help for one command

COMMANDS
  generate            Make a photograph
  upscale             Enlarge an existing image
  prompt              Show the photography brief for an intent, without generating
  reproduce           Re-run a generation from its .json sidecar
  health              One-line readiness summary (JSON with --json)
  doctor              Full diagnostic report
  benchmark           Measure model variants / LoRA / upscale on this machine
                      --suite variants|lora|upscale|realism|quick  --apply <variant>
  lora                list | info | enable | disable | install
  install-model       Download the configured Z-Image Turbo variant
  install-upscaler    Download an upscaler from the manifest
  render-html         Render an HTML file to PNG (needs Playwright)
  serve               Report warm-server status (never starts one)
  verify              Check installed weights against the manifest checksums
  prune               Delete weights the selected configuration does not use
  presets             List photographic presets
  sizes               List size presets
  manifest            Print the component manifest as JSON

GENERATE
  local-photo generate "médica conversando com paciente idosa"
  local-photo generate --prompt "MacBook aberto sobre mesa" --preset product
  local-photo generate "..." --size post-portrait --count 4 --output ./assets/

  The brief is a positional argument; --prompt/-p does the same thing.

  Every generation delivers two files by default: the requested path is the
  Lanczos 1.5x final artifact, and the model's own frame is kept next to it as
  <name>.raw.<ext>. Turn the enlargement off with --upscale off.

GLOBAL
  -h, --help          This text, or a command's own help
  -v, --version       Print the tool version
`;

/**
 * Per-command help.
 *
 * These are checked against the parser: every flag listed here exists, and
 * every flag the parser accepts is listed. Help that drifts from behaviour is
 * worse than no help at all.
 */
const HELP: Record<string, string> = {
  generate: `local-photo generate — make a photograph

USAGE
  local-photo generate "<brief>" [options]
  local-photo generate --prompt "<brief>" [options]

  The brief may be Portuguese or English. It is normalised into a photographic
  English brief (camera, light, texture, framing) unless --raw is passed.

OUTPUT
  By default two files are written per image:

    <name>.<ext>       the Lanczos 1.5x final artifact  <- the main result
    <name>.raw.<ext>   the model's own frame, unscaled and unfinished
    <name>.json        the reproducibility sidecar, referencing both

  --output names the FINAL artifact. The raw render never overwrites it.
  --upscale off delivers the raw render alone, as a single file.

OPTIONS
  -p, --prompt <text>       Same as the positional brief
      --preset <name>       ${PRESET_NAMES.join(" | ")}
                            (default: natural, or your configured preset)
      --size <name>         ${SIZE_PRESETS.join(" | ")}
      --width <n>           Explicit pixels; snapped to the model's stride
      --height <n>
      --count <n>           1-8 (default 1). With --seed, each frame steps
                            from it, so you get variations rather than clones
      --seed <n>            Deterministic seed (recorded either way)
      --steps <n>           Sampling steps override
      --guidance <n>        CFG override
  -o, --output <path>       Final file, or a directory when it ends in /
      --upscale <mode>      final (default) | off | auto
                            final = always Lanczos; auto = only when the
                            delivery size is meaningfully larger than the frame
      --upscale-scale <n>   Factor for the upscale pass (default 1.5)
      --lora <id|off>       Force a LoRA on or off for this call
      --lora-strength <n>   0..1
      --finish              Apply the subtle non-generative finish
      --raw                 Skip the prompt engine; send the text verbatim
      --no-metadata         Do not write the .json sidecar
      --json                Machine-readable result on stdout
  -q, --quiet               Suppress the progress and brief echo on stderr

EXAMPLES
  local-photo generate "médica conversando com paciente idosa" --preset clinical
  local-photo generate "MacBook sobre mesa" --preset product -o ./assets/hero.jpg
  local-photo generate "família na cozinha" --size post-portrait --count 4
  local-photo generate "recepção de clínica" --upscale off --seed 101
`,

  prompt: `local-photo prompt — show the brief without generating

USAGE
  local-photo prompt "<brief>" [options]

  Runs the photography prompt engine and prints what would be sent to the
  model, plus the rationale for every decision. Costs nothing.

OPTIONS
  -p, --prompt <text>       Same as the positional brief
      --preset <name>       ${PRESET_NAMES.join(" | ")}
      --seed <n>            Which deterministic variation to show (default 1)
      --all                 Show the brief for every preset
      --json                Machine-readable output

EXAMPLES
  local-photo prompt "casal idoso em casa" --all
  local-photo prompt "médica atendendo paciente" --preset clinical --seed 3
`,

  upscale: `local-photo upscale — enlarge an existing image

USAGE
  local-photo upscale <image> [options]

  Conservative by default: Lanczos resampling invents nothing. Generative
  upscalers are available but opt-in, and are a poor idea on skin.

OPTIONS
  -i, --input <path>        Same as the positional image
  -o, --output <path>       Default: <name>@<scale>x.<format> next to the input
      --scale <n>           Default 1.5
      --upscaler <id>       lanczos (default) | any id from config/models.json
      --finish              Apply capture sharpening on the way out
      --json                Machine-readable result

EXAMPLES
  local-photo upscale hero.jpg --scale 1.5
  local-photo upscale product.jpg --scale 2 --upscaler realesrgan-x2
`,

  reproduce: `local-photo reproduce — re-run a generation from its sidecar

USAGE
  local-photo reproduce <photo.json> [options]

  Replays the recorded seed, steps, guidance, size, variant and enhanced brief
  verbatim. Re-running the prompt engine would be a different experiment, so it
  is not re-run.

OPTIONS
  -o, --output <path>       Where to write the reproduction
      --json                Machine-readable result

EXAMPLE
  local-photo reproduce ./assets/hero.json -o ./assets/hero-again.jpg
`,

  benchmark: `local-photo benchmark — measure this machine

USAGE
  local-photo benchmark [--suite <name>] [options]

  Generates a fixed scenario set and writes images, timings and a report under
  bench/results/<id>/. This is how the shipped defaults were decided.

OPTIONS
      --suite <name>        variants (default) | lora | upscale | realism | quick
      --variants <a,b>      Restrict to these model variant ids
      --scenarios <a,b>     Restrict to these scenario ids
      --apply <variant>     Write the winning variant into the user config
      --out <dir>           Output directory (default: bench/results/<stamp>)
      --json                Machine-readable report

EXAMPLES
  local-photo benchmark --suite quick
  local-photo benchmark --suite variants --apply i8x
`,

  lora: `local-photo lora — manage the realism adapter

USAGE
  local-photo lora list
  local-photo lora info <id>
  local-photo lora enable <id> [--strength <n>]
  local-photo lora disable
  local-photo lora install <id>

  LoRAs are off by default; the raw model plus a good brief is the baseline to
  beat. A LoRA whose licence has not been verified for commercial use cannot be
  enabled — that is enforced here, not just documented.

EXAMPLES
  local-photo lora list
  local-photo lora enable realstagram-zimg --strength 0.4
  local-photo lora disable
`,

  verify: `local-photo verify — check installed weights

USAGE
  local-photo verify [options]

  Hashes the weights this configuration uses and compares them with the
  manifest. Exits non-zero on any mismatch.

OPTIONS
      --all                 Check every installed weight, not just the active set
      --json                Machine-readable report

EXAMPLE
  local-photo verify --all
`,

  prune: `local-photo prune — delete unused weights

USAGE
  local-photo prune [--yes]

  Lists the weights the selected configuration does not use, with the space
  they would free. Nothing is deleted without --yes. Re-downloading takes hours.

OPTIONS
  -y, --yes                 Actually delete
      --json                List the candidates as JSON, delete nothing

EXAMPLE
  local-photo prune
  local-photo prune --yes
`,

  serve: `local-photo serve — warm-server status

USAGE
  local-photo serve [--use | --off] [--json]

  Reports whether a Draw Things gRPC server is reachable. This project never
  starts one: on-demand is the default and costs zero memory while idle.

OPTIONS
      --use                 Route generations to the reachable warm server
      --off                 Go back to on-demand
      --json                Machine-readable status

EXAMPLE
  local-photo serve
`,

  "render-html": `local-photo render-html — HTML/CSS to PNG

USAGE
  local-photo render-html <file.html|url> -o <out.png> [options]

  Needs Playwright (installed by ./scripts/install.sh --full).

OPTIONS
  -o, --output <path>       Default: render.png
      --width <n>           Viewport width
      --height <n>          Viewport height
      --selector <css>      Screenshot one element instead of the viewport
      --scale <n>           Device scale factor (2 for retina output)
      --full-page           Capture the whole scrollable page

EXAMPLE
  local-photo render-html post.html -o post.png --width 1080 --height 1350
`,

  health: `local-photo health — one-line readiness summary

USAGE
  local-photo health [--json]

  Exits 0 when the engine, model and companions are ready, 1 otherwise.
  Use \`local-photo doctor\` for the full report.
`,

  doctor: `local-photo doctor — full diagnostic report

USAGE
  local-photo doctor

  Platform, engine, model, LoRA, licensing, upscaler, disk, integrations and
  the resolved configuration paths. Exits non-zero when a check fails.
`,

  "install-model": `local-photo install-model — download the checkpoint

USAGE
  local-photo install-model [--variant <id>] [--no-verify]

  Downloads the configured Z-Image Turbo variant and its companions into the
  models directory, then verifies checksums.

OPTIONS
      --variant <id>        Install a specific variant instead of the configured one
      --no-verify           Skip the checksum pass after downloading
`,

  "install-upscaler": `local-photo install-upscaler — download an upscaler

USAGE
  local-photo install-upscaler <id>

  Ids come from config/models.json. Lanczos needs no download.
`,

  presets: `local-photo presets — list photographic presets

USAGE
  local-photo presets

  The configured default is marked with *.
`,

  sizes: `local-photo sizes — list size presets

USAGE
  local-photo sizes

  Each one generates at a model-friendly size and resizes to the delivery
  dimensions, so faces do not stretch.
`,

  manifest: `local-photo manifest — print the component manifest

USAGE
  local-photo manifest

  Every generator, upscaler and LoRA with its licence, source and
  commercial-use verdict, as JSON.
`,
};

function num(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) ui.fail(`--${name} must be a number, got "${value}"`);
  return parsed;
}

// ---------------------------------------------------------------------------

async function cmdGenerate(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      prompt: { type: "string", short: "p" },
      preset: { type: "string" },
      size: { type: "string" },
      width: { type: "string" },
      height: { type: "string" },
      count: { type: "string" },
      seed: { type: "string" },
      steps: { type: "string" },
      guidance: { type: "string" },
      output: { type: "string", short: "o" },
      upscale: { type: "string" },
      "upscale-scale": { type: "string" },
      lora: { type: "string" },
      "lora-strength": { type: "string" },
      finish: { type: "boolean" },
      raw: { type: "boolean" },
      "no-metadata": { type: "boolean" },
      json: { type: "boolean" },
      quiet: { type: "boolean", short: "q" },
    },
  });

  // `generate "médica atendendo uma idosa"` is what everyone types first, and
  // it used to be silently ignored. --prompt keeps working for every script
  // already written against it.
  const prompt = (values.prompt ?? positionals.join(" ")).trim();
  if (!prompt) {
    ui.fail(
      'A brief is required: local-photo generate "médica conversando com paciente idosa"\n' +
        "See: local-photo generate --help",
    );
  }

  const service = new LocalPhotoService();
  const verbose = !values.json && !values.quiet;

  const result = await service.generate({
    prompt,
    ...(values.preset ? { preset: values.preset as PresetName } : {}),
    ...(values.size ? { size: values.size as SizePreset } : {}),
    ...(values.width ? { width: num(values.width, "width")! } : {}),
    ...(values.height ? { height: num(values.height, "height")! } : {}),
    ...(values.count ? { count: num(values.count, "count")! } : {}),
    ...(values.seed ? { seed: num(values.seed, "seed")! } : {}),
    ...(values.steps ? { steps: num(values.steps, "steps")! } : {}),
    ...(values.guidance ? { guidance: num(values.guidance, "guidance")! } : {}),
    ...(values.output ? { output: values.output } : {}),
    ...(values.upscale ? { upscale: values.upscale as UpscaleMode } : {}),
    ...(values["upscale-scale"] ? { upscaleScale: num(values["upscale-scale"], "upscale-scale")! } : {}),
    ...(values.lora ? { lora: values.lora === "off" ? false : values.lora } : {}),
    ...(values["lora-strength"] ? { loraStrength: num(values["lora-strength"], "lora-strength")! } : {}),
    ...(values.finish ? { finish: true } : {}),
    ...(values.raw ? { raw: true } : {}),
    ...(values["no-metadata"] ? { metadata: false } : {}),
    ...(verbose
      ? { onProgress: (m: string) => process.stderr.write(`${ui.grey(m)}\n`) }
      : {}),
  });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const record = result.records[0];
  if (verbose && record) {
    process.stderr.write(`\n${ui.dim(record.prompt_enhanced)}\n\n`);
  }
  // stdout carries the delivered artifacts and nothing else, so `$(local-photo
  // generate …)` still yields a path a script can use. The raw renders are
  // reported alongside on stderr.
  for (const file of result.files) process.stdout.write(`${file}\n`);
  if (verbose) {
    for (const raw of result.rawFiles) {
      process.stderr.write(ui.grey(`raw render kept at ${raw}\n`));
    }
    const upscaleMs = result.timings.upscaleMs ?? 0;
    process.stderr.write(
      ui.grey(
        `${result.files.length} image(s) in ${ui.duration(result.timings.totalMs)} ` +
          `(backend ${ui.duration(result.timings.backendMs)}` +
          (upscaleMs > 0 ? `, ${upscaleLabel(record)} ${ui.duration(upscaleMs)}` : "") +
          `)\n`,
      ),
    );
  }
}

/** Names the upscale that actually ran, for the one-line summary. */
function upscaleLabel(record: PhotoRecord | undefined): string {
  if (!record?.upscaler) return "upscale";
  return `${record.upscaler} ${record.upscale_scale ?? 1}x`;
}

async function cmdPrompt(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      prompt: { type: "string", short: "p" },
      preset: { type: "string" },
      seed: { type: "string" },
      json: { type: "boolean" },
      all: { type: "boolean" },
    },
  });

  const text = values.prompt ?? positionals.join(" ");
  if (!text) ui.fail('Usage: local-photo prompt "médica conversando com paciente idosa"');

  const seed = num(values.seed, "seed") ?? 1;
  const presets = values.all ? PRESET_NAMES : [(values.preset ?? loadConfig().preset) as PresetName];

  const outputs = presets.map((preset) => ({
    preset,
    ...buildPrompt({ prompt: text, preset, seed, allowNegative: false }),
  }));

  if (values.json) {
    process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);
    return;
  }

  for (const out of outputs) {
    process.stdout.write(`${ui.heading(out.preset)}\n${out.positive}\n`);
    process.stdout.write(`${ui.grey(out.rationale.map((r) => `  · ${r}`).join("\n"))}\n`);
  }
}

async function cmdHealth(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { json: { type: "boolean" } } });
  const health = await new LocalPhotoService().health();

  if (values.json) {
    process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);
    process.exit(health.ok ? 0 : 1);
  }

  const failed = health.checks.filter((c) => c.status === "fail");
  process.stdout.write(
    health.ok
      ? `${ui.green("ready")} — ${health.model.id} (${health.model.variant}) on ${health.platform.chip}, ${health.engine.mode}\n`
      : `${ui.red("not ready")} — ${failed.map((c) => c.label).join(", ")}\n`,
  );
  process.exit(health.ok ? 0 : 1);
}

async function cmdDoctor(): Promise<void> {
  const service = new LocalPhotoService();
  const health = await service.health();
  const config = service.configuration;
  const out: string[] = [];

  out.push(ui.bold("\nLocal Photo AI M5"), "");
  out.push(ui.bold("Platform"));
  out.push(ui.row("chip", health.platform.chip));
  out.push(ui.row("memory", `${health.platform.memoryGB} GB unified`));
  out.push(ui.row("os", health.platform.os));
  out.push(ui.row("free disk", `${health.platform.freeDiskGB} GB`));

  const group = (title: string, ids: string[]) => {
    out.push("", ui.bold(title));
    for (const id of ids) {
      const check = health.checks.find((c) => c.id === id);
      if (!check) continue;
      const label = check.label.length > 25 ? `${check.label.slice(0, 24)}…` : check.label;
      out.push(ui.row(label, `${ui.statusMark(check.status)}  ${ui.grey(check.detail ?? "")}`, 26));
      if (check.hint) out.push(ui.row("", ui.yellow(`↳ ${check.hint}`), 26));
    }
  };

  group("Engine", ["draw-things-app", "draw-things-cli"]);
  group("Generation", ["model", "prompt-engine"]);
  group("Realism", ["lora", "commercial-use"]);
  group("Upscale", ["upscaler"]);
  group("Storage", ["disk"]);

  out.push("", ui.bold("Integration"));
  const piExt = `${process.env.HOME}/.pi/agent/extensions/local-photo`;
  out.push(
    ui.row("Pi extension", `${ui.statusMark(existsSync(piExt) ? "ok" : "disabled")}  ${ui.grey(piExt)}`, 26),
  );
  const mcpEntry = join(repoRoot(), "dist", "mcp", "server.js");
  const mcpBuilt = existsSync(mcpEntry);
  let mcpRegistered = false;
  try {
    const listed = await run("claude", ["mcp", "list"], { timeoutMs: 15_000 });
    mcpRegistered = /^local-photo\b/m.test(listed.stdout);
  } catch {
    // The Claude Code CLI is optional; other MCP clients are configured elsewhere.
  }
  out.push(
    ui.row(
      "MCP server",
      `${ui.statusMark(mcpBuilt ? (mcpRegistered ? "ok" : "warn") : "fail")}  ` +
        ui.grey(
          mcpBuilt
            ? mcpRegistered
              ? "stdio, registered with Claude Code"
              : "stdio, built but not registered with Claude Code"
            : "not built — run npm run build",
        ),
      26,
    ),
  );
  if (mcpBuilt && !mcpRegistered) {
    out.push(ui.row("", ui.grey(`↳ claude mcp add local-photo -- node ${mcpEntry}`), 26));
  }

  out.push("", ui.bold("Configuration"));
  out.push(ui.row("models dir", modelsDir(), 26));
  out.push(ui.row("state dir", stateDir(), 26));
  out.push(ui.row("logs", logsDir(), 26));
  out.push(ui.row("default preset", config.preset, 26));
  out.push(ui.row("steps / cfg", `${config.model.steps} / ${config.model.guidance}`, 26));
  out.push(ui.row("output", `${config.output.format} q${config.output.quality}`, 26));
  out.push(
    ui.row(
      "inference mode",
      config.warm?.enabled
        ? `warm (${config.warm.host}:${config.warm.port})`
        : "on-demand (nothing resident)",
      26,
    ),
  );
  out.push("");

  process.stdout.write(`${out.join("\n")}\n`);
  process.exit(health.ok ? 0 : 1);
}

async function cmdUpscale(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      input: { type: "string", short: "i" },
      output: { type: "string", short: "o" },
      scale: { type: "string" },
      upscaler: { type: "string" },
      finish: { type: "boolean" },
      json: { type: "boolean" },
    },
  });

  const input = values.input ?? positionals[0];
  if (!input) ui.fail("Usage: local-photo upscale <image> [--scale 1.5]");

  const result = await new LocalPhotoService().upscale({
    input,
    ...(values.output ? { output: values.output } : {}),
    ...(values.scale ? { scale: num(values.scale, "scale")! } : {}),
    ...(values.upscaler ? { upscaler: values.upscaler } : {}),
    ...(values.finish ? { finish: true } : {}),
  });

  if (values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${result.files[0]}\n`);
}

async function cmdReproduce(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { output: { type: "string", short: "o" }, json: { type: "boolean" } },
  });
  const record = positionals[0];
  if (!record) ui.fail("Usage: local-photo reproduce <photo.json>");

  const result = await reproduce(resolve(record), values.output ? { output: values.output } : {});
  if (values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${result.files[0]}\n`);
}

async function cmdLora(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  const config = loadConfig();

  switch (sub) {
    case undefined:
    case "list": {
      const rows = await listLoraStatus();
      process.stdout.write(
        `${ui.table([
          [ui.bold("ID"), ui.bold("NAME"), ui.bold("BASE"), ui.bold("COMMERCIAL"), ui.bold("INSTALLED"), ui.bold("STATE")],
          ...rows.map((r) => [
            r.id,
            r.name.slice(0, 42),
            r.base ?? "-",
            r.commercial ? ui.green("yes") : ui.red("NO"),
            r.installed ? "yes" : "no",
            r.active ? ui.cyan("active") : r.candidate,
          ]),
        ])}\n`,
      );
      if (rows.some((r) => !r.commercial)) {
        process.stdout.write(
          ui.grey("\nEntries marked COMMERCIAL=NO cannot be enabled — see docs/MODELS.md\n"),
        );
      }
      return;
    }

    case "info": {
      const id = rest[0];
      if (!id) ui.fail("Usage: local-photo lora info <id>");
      const lora = loraById(id);
      if (!lora) ui.fail(`Unknown LoRA "${id}"`);
      process.stdout.write(`${JSON.stringify(lora, null, 2)}\n`);
      return;
    }

    case "enable": {
      const id = rest[0];
      if (!id) ui.fail("Usage: local-photo lora enable <id> [--strength 0.5]");
      const lora = loraById(id);
      if (!lora) ui.fail(`Unknown LoRA "${id}"`);
      if (!lora.commercial_use_verified) {
        ui.fail(
          `"${lora.name}" is not cleared for commercial use and cannot be enabled.\n` +
            (lora.rejection_reason ?? ""),
        );
      }
      const strengthArg = rest.indexOf("--strength");
      const strength =
        strengthArg >= 0 ? Number(rest[strengthArg + 1]) : config.lora.strength;
      const path = saveUserConfig({ lora: { id, enabled: true, strength } });
      process.stdout.write(`enabled ${lora.name} @ ${strength}\n${ui.grey(path)}\n`);
      return;
    }

    case "disable": {
      const path = saveUserConfig({ lora: { enabled: false } });
      process.stdout.write(`LoRA disabled — raw model + prompt engine\n${ui.grey(path)}\n`);
      return;
    }

    case "install": {
      const id = rest[0];
      if (!id) ui.fail("Usage: local-photo lora install <id>");
      const path = await installLora(id, {
        onProgress: (m) => process.stderr.write(`${ui.grey(m)}\n`),
      });
      process.stdout.write(`${path}\n`);
      return;
    }

    default:
      ui.fail(`Unknown subcommand "lora ${sub}". Try: list, info, enable, disable, install`);
  }
}

async function cmdInstallModel(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { variant: { type: "string" }, "no-verify": { type: "boolean" } },
  });
  const config = loadConfig();
  if (values.variant) config.model.variant = values.variant;
  const variant = activeVariant(config);
  const backend = new DrawThingsBackend();

  process.stderr.write(`${ui.grey(`downloading ${variant.file} into ${modelsDir()}`)}\n`);
  await backend.ensureModel(variant.file, {
    onProgress: (m) => process.stderr.write(`${ui.grey(m)}\r`),
  });

  // A multi-gigabyte transfer over a throttled CDN is exactly the situation
  // where a silent truncation is worth catching immediately, rather than as a
  // confusing failure three commands later.
  if (!values["no-verify"]) {
    process.stderr.write(`\n${ui.grey("verifying checksums…")}\n`);
    const report = await verifyIntegrity({
      onProgress: (m) => process.stderr.write(`${ui.grey(m)}\n`),
    });
    const bad = report.entries.filter((e) => e.status === "mismatch");
    if (bad.length > 0) {
      ui.fail(
        `Checksum mismatch after download: ${bad.map((e) => e.file).join(", ")}.\n` +
          "Delete those files and re-run: local-photo install-model",
      );
    }
  }

  process.stdout.write(`\n${generator(config).name} (${variant.catalog_name}) ready\n`);
}

async function cmdInstallUpscaler(argv: string[]): Promise<void> {
  const id = argv[0];
  if (!id) ui.fail("Usage: local-photo install-upscaler <id>   (see config/models.json)");
  const upscaler = upscalerById(id);
  if (!upscaler) ui.fail(`Unknown upscaler "${id}"`);
  if (!upscaler.file) {
    process.stdout.write(`${upscaler.name} needs no download.\n`);
    return;
  }
  const path = await installUpscaler(id, {
    onProgress: (m) => process.stderr.write(`${ui.grey(m)}\n`),
  });
  process.stdout.write(`${path}\n`);
}

async function cmdBenchmark(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      suite: { type: "string" },
      variants: { type: "string" },
      apply: { type: "string" },
      json: { type: "boolean" },
      out: { type: "string" },
      scenarios: { type: "string" },
    },
  });

  const report = await runBenchmark({
    suite: (values.suite as never) ?? "variants",
    ...(values.variants ? { variants: values.variants.split(",") } : {}),
    ...(values.scenarios ? { scenarios: values.scenarios.split(",") } : {}),
    ...(values.out ? { outDir: values.out } : {}),
    ...(values.apply ? { apply: values.apply } : {}),
    onProgress: (m) => process.stderr.write(`${ui.grey(m)}\n`),
  });

  if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${formatBenchmark(report)}\n`);
}

async function cmdRenderHtml(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      width: { type: "string" },
      height: { type: "string" },
      selector: { type: "string" },
      scale: { type: "string" },
      "full-page": { type: "boolean" },
    },
  });

  const input = positionals[0];
  if (!input) ui.fail("Usage: local-photo render-html <file.html|url> -o out.png --width 1080 --height 1350");

  const file = await renderHtml({
    input,
    output: values.output ?? "render.png",
    ...(values.width ? { width: num(values.width, "width")! } : {}),
    ...(values.height ? { height: num(values.height, "height")! } : {}),
    ...(values.selector ? { selector: values.selector } : {}),
    ...(values.scale ? { deviceScaleFactor: num(values.scale, "scale")! } : {}),
    ...(values["full-page"] ? { fullPage: true } : {}),
  });
  process.stdout.write(`${file}\n`);
}

async function cmdServe(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" }, use: { type: "boolean" }, off: { type: "boolean" } },
  });

  const status = await probeWarmServer();

  if (values.json) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return;
  }

  if (values.off) {
    const path = saveUserConfig({ warm: { enabled: false } });
    process.stdout.write(`warm mode off — back to on-demand\n${ui.grey(path)}\n`);
    return;
  }

  if (values.use) {
    if (!status.reachable) ui.fail(`No warm server at ${status.host}:${status.port}.\n${status.hint}`);
    const path = saveUserConfig({ warm: { enabled: true, host: status.host, port: status.port } });
    process.stdout.write(
      `warm mode on — generations route to ${status.host}:${status.port}\n${ui.grey(path)}\n`,
    );
    return;
  }

  process.stdout.write(
    status.reachable
      ? `${ui.green("reachable")} ${status.host}:${status.port} (${status.latencyMs}ms)\n${ui.grey(status.hint)}\n`
      : `${ui.yellow("no warm server")} ${status.host}:${status.port}\n${ui.grey(status.hint)}\n` +
          ui.grey(`  • the app's HTTP API server, when enabled, listens on ${DEFAULT_HTTP_PORT}\n`) +
          ui.grey("\nOn-demand is the default and costs zero memory while idle.\n"),
  );
}

async function cmdVerify(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { all: { type: "boolean" }, json: { type: "boolean" } },
  });

  const report = await verifyIntegrity({
    ...(values.all ? { all: true } : {}),
    ...(values.json ? {} : { onProgress: (m: string) => process.stderr.write(`${ui.grey(m)}\n`) }),
  });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.ok ? 0 : 1);
  }

  const rows = report.entries.map((e) => [
    e.status === "ok"
      ? ui.green("ok")
      : e.status === "repacked"
        ? ui.green("ok*")
        : e.status === "mismatch"
          ? ui.red("MISMATCH")
          : e.status === "missing"
            ? ui.yellow("missing")
            : ui.grey("no checksum"),
    e.file,
    e.sizeGB ? `${e.sizeGB} GB` : "-",
    ui.grey(e.note ? `${e.role} — ${e.note}` : e.role),
  ]);
  process.stdout.write(`${ui.table(rows, 2)}\n`);

  for (const entry of report.entries.filter((e) => e.status === "mismatch")) {
    process.stdout.write(
      `\n${ui.red("mismatch")} ${entry.file}\n  expected ${entry.expected}\n  actual   ${entry.actual}\n` +
        ui.grey("  Delete the file and re-run: local-photo install-model\n"),
    );
  }
  process.exit(report.ok ? 0 : 1);
}

async function cmdPrune(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { yes: { type: "boolean", short: "y" }, json: { type: "boolean" } },
  });

  const candidates = prunableWeights();
  if (values.json) {
    process.stdout.write(`${JSON.stringify(candidates, null, 2)}\n`);
    return;
  }

  if (candidates.length === 0) {
    process.stdout.write("Nothing to prune — every installed weight belongs to the current configuration.\n");
    return;
  }

  const total = candidates.reduce((sum, c) => sum + c.bytes, 0);
  process.stdout.write(
    `${ui.table([
      [ui.bold("FILE"), ui.bold("SIZE"), ui.bold("WHY")],
      ...candidates.map((c) => [c.file, `${(c.bytes / 1024 ** 3).toFixed(2)} GB`, ui.grey(c.reason)]),
    ])}\n\n` +
      `${ui.bold(`${(total / 1024 ** 3).toFixed(2)} GB`)} would be freed. ` +
      ui.grey("Re-downloading these takes hours.\n"),
  );

  if (!values.yes) {
    process.stdout.write(ui.yellow("\nNothing deleted. Re-run with --yes to delete.\n"));
    return;
  }

  const dir = modelsDir();
  for (const candidate of candidates) {
    for (const path of [join(dir, candidate.file), `${join(dir, candidate.file)}-tensordata`]) {
      if (existsSync(path)) rmSync(path, { force: true });
    }
    process.stdout.write(`removed ${candidate.file}\n`);
  }
  process.stdout.write(ui.green(`\nfreed ${(total / 1024 ** 3).toFixed(2)} GB\n`));
}

function cmdPresets(): void {
  const rows = Object.values(PRESETS).map((p) => [
    p.id === loadConfig().preset ? ui.cyan(`${p.id} *`) : p.id,
    p.summary,
  ]);
  process.stdout.write(`${ui.table(rows, 3)}\n`);
}

function cmdSizes(): void {
  process.stdout.write(`${SIZE_PRESETS.join("\n")}\n`);
}

function cmdManifest(): void {
  process.stdout.write(`${JSON.stringify(loadManifest(), null, 2)}\n`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`${toolVersion()}\n`);
    return;
  }

  // `help <command>` and `<command> --help` reach the same text. Help has to be
  // intercepted before parseArgs, which rejects flags it was not told about —
  // which is exactly why `generate --help` used to fail.
  // hasOwn, not a truthy check: "help toString" would otherwise find
  // Object.prototype.toString, pass the guard as a function and crash on write.
  const helpFor = (name: string): string | null =>
    Object.hasOwn(HELP, name) ? HELP[name]! : null;

  if (command === "help") {
    const topic = argv[0];
    if (!topic) {
      process.stdout.write(USAGE);
      return;
    }
    const help = helpFor(topic);
    if (!help) ui.fail(`Unknown command "${topic}".\n${USAGE}`);
    process.stdout.write(help);
    return;
  }

  // Anything after a bare `--` is the caller's data, not our flags.
  const flagEnd = argv.indexOf("--");
  const flags = flagEnd === -1 ? argv : argv.slice(0, flagEnd);
  if (flags.some((arg) => arg === "--help" || arg === "-h")) {
    // A typo must fail whether or not --help came with it, or scripts probing
    // "local-photo <cmd> --help" get a clean exit for commands that do not exist.
    const help = helpFor(command);
    if (!help) ui.fail(`Unknown command "${command}".\n${USAGE}`);
    process.stdout.write(help);
    return;
  }

  switch (command) {
    case "generate":
      return cmdGenerate(argv);
    case "prompt":
      return cmdPrompt(argv);
    case "health":
      return cmdHealth(argv);
    case "doctor":
      return cmdDoctor();
    case "upscale":
      return cmdUpscale(argv);
    case "reproduce":
      return cmdReproduce(argv);
    case "lora":
      return cmdLora(argv);
    case "install-model":
      return cmdInstallModel(argv);
    case "install-upscaler":
      return cmdInstallUpscaler(argv);
    case "benchmark":
      return cmdBenchmark(argv);
    case "render-html":
      return cmdRenderHtml(argv);
    case "serve":
      return cmdServe(argv);
    case "verify":
      return cmdVerify(argv);
    case "prune":
      return cmdPrune(argv);
    case "presets":
      return cmdPresets();
    case "sizes":
      return cmdSizes();
    case "manifest":
      return cmdManifest();
    default:
      ui.fail(`Unknown command "${command}".\n${USAGE}`);
  }
}

main().catch((error: unknown) => {
  ui.fail(error instanceof Error ? error.message : String(error));
});
