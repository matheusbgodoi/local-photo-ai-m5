# Architecture

## The seam

There is exactly one architectural idea in this project, and everything else
follows from it:

> **The agent asks for a photograph. The service decides how to make one.**

Above the seam: prompts, presets, sizes, file paths. Below it: checkpoints,
samplers, quantisation, Metal, LoRA weights, upscaler zoos. Nothing crosses.

This is why `src/core/types.ts` contains no word like "ckpt" or "sampler", and
why the MCP tool description talks about doctors and product shots rather than
diffusion parameters. An LLM asked to pick a sampler will pick badly and
confidently; an LLM asked to describe a scene will do well.

```
        ┌─────────────┐   ┌──────────────┐   ┌─────────────┐
        │     CLI     │   │ Pi extension │   │ MCP (stdio) │
        └──────┬──────┘   └──────┬───────┘   └──────┬──────┘
               │                 │                  │
               └────────────┬────┴──────────────────┘
                            ▼
                  ┌────────────────────┐
                  │   PhotoService     │   ← the seam
                  │  health/generate/  │
                  │   upscale/edit?    │
                  └─────────┬──────────┘
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │ prompt engine│  │  DrawThings  │  │    finish    │
  │ (deterministic)│ │   backend    │  │ (sharp, non- │
  └──────────────┘  └──────┬───────┘  │  generative) │
                           ▼          └──────────────┘
                   draw-things-cli
                           ▼
                     Z-Image Turbo
```

## Why three front-ends and not one

They are not alternatives; they serve different callers.

- **Pi** is the user's primary agent, and it has **no built-in MCP client**
  (its own docs say so explicitly). So the Pi integration must be a native
  extension. It is not a bridge to the MCP server — it calls the core directly.
- **MCP** exists for every *other* client (Claude Code, and anything else that
  speaks the protocol). stdio, so no server has to be running: the client
  spawns the process when it wants a photograph and it exits afterwards.
- **The CLI** is for a human, for scripts, and for the installer's smoke test.

The rule that keeps them honest: none of them contains logic. Each one is
argument parsing plus a call into `PhotoService`. If a behaviour needs
changing, there is exactly one place to change it.

## Module map

| module | responsibility |
| --- | --- |
| `core/types.ts` | the contract. The whole agent-facing vocabulary. |
| `core/service.ts` | orchestration: sizes, seeds, LoRA resolution, output paths, sidecars |
| `core/backend/drawthings.ts` | the only file that knows what a `.ckpt` is |
| `core/prompt/` | the photography prompt engine (see below) |
| `core/config.ts` | shipped defaults + machine-learned overrides + manifest |
| `core/lora.ts` | adapter download, checksum, licence enforcement |
| `core/finish.ts` | non-generative finishing, sanity checks |
| `core/sizes.ts` | model-friendly generation size vs delivery size |
| `core/system.ts` | platform probing, memory sampling during a run |
| `core/benchmark.ts` | measures what can be measured, lays out frames for judging |
| `cli/` · `mcp/` · `pi/` | the three doorways |
| `render/html.ts` | HTML → PNG, Playwright, lazily imported |

## The prompt engine

Four stages, all deterministic:

```
intent (pt-BR or en)
   │
   ▼  translate.ts    dictionary, gender-preserving, never paraphrases
English intent
   │
   ▼  analyze.ts      who/what/where/how close — pattern matching only
scene analysis
   │
   ▼  presets.ts      the photographic doctrine for this kind of coverage
   │  engine.ts       compose: subject → texture → light → glass → framing
photography brief
```

Determinism comes from a seeded PRNG (`rng.ts`) keyed on
`prompt|preset|seed`. Two images from one request get different briefs, because
their seeds differ; the same request replayed gets the same brief, because the
seed is recorded.

The analysis stage exists so the engine can be *contextual* rather than
formulaic. It never invents facts — it only notices ones already stated, which
is what lets rule 14 of the brief ("do not change semantics") be enforced
rather than hoped for.

## The delivery path

```
brief → prompt engine → draw-things-cli → frame ─┬─► <name>.raw.<ext>   kept
                                                 │
                                                 └─► Lanczos 1.5x → resize
                                                     → encode → <name>.<ext>
                                                                      delivered
```

The path the caller named is always the delivered file; the raw render gets its
own name and is never overwritten by anything downstream. `--upscale off`
collapses the fork and delivers the frame directly, as one file. Both paths are
recorded, absolutely, in the `.json` sidecar — which is what makes
`local-photo reproduce` and any later re-upscale possible.

## Inference model: on-demand

```
tool call → local-photo → draw-things-cli → load → generate → save → exit
```

One process per generation. It exits. Idle memory cost is zero, nothing is
registered with launchd, and nothing starts at login.

The cost is the model load on every cold call. `local-photo benchmark` measures
exactly what that costs on this machine — see [BENCHMARK.md](BENCHMARK.md) for
the numbers and for whether a warm server is worth it.

A warm mode is possible (Draw Things ships a gRPC server binary, and the app
can expose an HTTP API on `127.0.0.1:7860`), but it is not wired up as a
default and never starts automatically. See BENCHMARK.md for the reasoning.

## Configuration layering

```
config/default.json          shipped with the repo
        ▼  merged
<state>/config.json          what this machine decided
        ▼  merged
CLI flags / tool arguments   what this call wants
```

`local-photo benchmark --apply <variant>` writes into the middle layer. That is
how a fresh clone starts from sensible defaults and then adapts to the hardware
it lands on, without editing anything under version control.

## What is deliberately absent

- **No `edit()`.** Instruction-based editing on the Z-Image family needs a
  second large checkpoint. The interface has the slot; the implementation is
  absent, because advertising a capability that does not work is worse than
  not having it. `PhotoService.edit` is optional in the type for this reason.
- **No model zoo.** One generator family. Adding a second is a manifest entry
  plus a download, not a refactor — but it is a decision, not a default.
- **No daemon.** Nothing to forget you are running.
- **No cloud fallback.** `draw-things-cli` has `--cloud-compute`; this project
  never passes it.
