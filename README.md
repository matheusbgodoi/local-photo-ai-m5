# local-photo-ai-m5

On-device photography for an Apple Silicon Mac. One tool call in, one
believable photograph out.

[![License: MIT](https://img.shields.io/badge/License-MIT-7c9082.svg)](LICENSE)
[![macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple%20Silicon-0a0a0a.svg)](#installation)
[![MCP: stdio](https://img.shields.io/badge/MCP-stdio-7c9082.svg)](docs/MCP.md)

```
"preciso de uma foto de uma médica conversando com uma idosa
 para essa seção do site"
        │
        ▼
  Pi / MCP / CLI  ──►  photography prompt engine  ──►  Draw Things
        │                                                  │
        ▼                                             Z-Image Turbo
   ./public/assets/hero.jpg                                │
                                                     Apple M5 GPU
```

Nothing leaves the machine. Nothing heavy stays resident.

---

## What this is

A photography capability for a coding agent, not a Stable Diffusion front-end.

The goal is narrow and deliberate: **replace commissioned commercial
photography with synthetic images that a normal person would assume a
photographer actually took.** Doctors, elderly people, families, clinics,
offices, phones, laptops, medical devices, hero images, campaign assets.

It is explicitly *not* trying to make AI art. Everything about the system —
the prompt engine, the preset list, the defaults, the upscaling policy — is
tuned against the things that make generated images look generated:

| what we avoid | why |
| --- | --- |
| plastic, poreless skin | the single most reliable AI tell |
| perfect symmetry | real faces are asymmetric |
| cinematic light on everything | a clinic is lit by a ceiling panel, not a gaffer |
| heavy bokeh everywhere | a 35mm frame at f/4 does not dissolve the room |
| HDR, microcontrast, oversharpening | none of it survives a second look |
| impeccable, empty environments | real rooms have paperwork and cables |
| stock-photo poses | nobody in a real photograph is presenting to camera |

Naturalness beats spectacle. Every time.

---

## Results from the local pipeline

All three images below were produced on a Mac through this Draw Things-based
pipeline. They are committed as documentation assets so readers can inspect
the full files instead of relying on compressed screenshots.

| documentary | natural scene | light and atmosphere |
| --- | --- | --- |
| [![Fisherman repairing a net in a boat](docs/assets/examples/documental-fisherman.jpg)](docs/assets/examples/documental-fisherman.jpg) | [![Dog sleeping under a tree in a rainy park](docs/assets/examples/dog-sleeping-in-rainy-park.jpg)](docs/assets/examples/dog-sleeping-in-rainy-park.jpg) | [![Empty basketball court in golden light](docs/assets/examples/golden-basketball-court.jpg)](docs/assets/examples/golden-basketball-court.jpg) |

The prompts shown in [the examples guide](docs/EXAMPLES.md) reproduce the
same kinds of brief. The original sidecars for these three historical renders
were not retained, so the documentation does not invent seeds or claim
pixel-identical reproduction.

---

## Architecture

```
  MCP client / CLI / Pi
            │
            ▼
  photography prompt engine
            │
            ▼
     draw-things-cli
            │
            ▼
      Z-Image Turbo
            │
            ▼
  Apple Silicon GPU (on demand)
```

Three doorways, one implementation:

- **CLI** — `local-photo generate …` for a human at a terminal.
- **Pi extension** — native tools in every repo, globally installed.
- **MCP server** — stdio, for Claude Code or any other MCP client.

All three call the same `PhotoService`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Why Z-Image Turbo

One model, learned properly, beats a model zoo.

- **Apache-2.0.** Commercial use is unambiguous, which matters because these
  images end up in company marketing.
- **6B parameters, distilled.** It produces a usable frame in single-digit
  steps, so iterating on a photograph feels like iterating on code.
- **It is not a "beauty" model.** Its default output is closer to plain
  photography than to the glossy house style of most current checkpoints,
  which means the prompt engine has less to fight.
- **First-class in Draw Things**, including quantised variants tuned for
  Apple Silicon.

FLUX.2, SDXL, Qwen-Image and friends are deliberately *not* installed. See
[docs/MODELS.md](docs/MODELS.md).

---

## The natural photography engine

This is the part that matters. The model is a commodity; the brief is not.

You write:

```
médica conversando com paciente idosa em uma clínica
```

The engine writes:

```
An observational photograph of a female doctor talking with elderly female
patient in a clinic, caught between moments rather than posed. natural
age-related wrinkles and an ordinary, unretouched complexion, natural hair
that moves in separate strands, hands in a relaxed, physically plausible
position. soft window light on one side, ceiling light filling the rest,
shot on a full-frame camera with a 35mm lens at eye level, moderate depth of
field, the room still recognisable behind the subject. framed with the
room's clutter left in, slight sensor grain in the shadows, the room shows
everyday use: paperwork, cables, worn surfaces and objects left where people
put them. An ordinary clinical moment, recorded rather than staged.
```

It is **semantic normalisation, not literal translation**. On a real brief, the
difference is the whole result:

```
fotografia documental de uma médica brasileira de 42 anos em atendimento
com uma paciente idosa em um hospital público, luz fluorescente misturada
com luz natural lateral, pele com textura normal, sem retoque de beleza,
sem aparência de stock photo, jaleco branco usado normalmente
```

```diff
- photograph documental of a Brazilian female doctor aged 42 in atendimento
- with an elderly female patient in a hospital público, luz fluorescente
- misturada with natural light lateral, pele with textura normal, without
- retoque of beleza, without aparência of stock photo, white lab coat usado
- normalmente
+ documentary photograph of a Brazilian female doctor aged 42 during a
+ consultation with an elderly female patient in a public hospital, fluorescent
+ light mixed with natural light from the side, skin with ordinary texture, no
+ beauty retouching, not looking like a stock photo, white lab coat worn
+ normally
```

55 % of the content words recognised, before. 100 % after — with the Brazilian
identity, the public hospital, the stated age and every realism clause still in
the brief. And because the brief already says it is a photograph, the preset's
own opener is dropped instead of stacked on top of it, so the result no longer
reads *"A photograph …, showing a documentary photograph of …"*.

Three rules govern it:

1. **It never changes a fact.** Age, gender, ethnicity, headcount, product,
   brand, clothing, action and setting come from you and only from you. It
   adds camera, light, material behaviour, texture and framing — nothing else.
2. **It is contextual.** A product does not get skin texture. A child does not
   get age-related wrinkles. An 85mm lens only appears when portrait
   compression actually makes sense. A phone snapshot does not get a
   full-frame camera.
3. **It is deterministic.** The same prompt, preset and seed always produce
   the same brief — otherwise `local-photo reproduce` would be fiction.

Preview it without spending a generation:

```bash
local-photo prompt "casal idoso em casa" --all
```

Details, including what was tested and what was thrown away, in
[docs/PHOTOGRAPHY.md](docs/PHOTOGRAPHY.md).

---

## Installation

```bash
git clone https://github.com/matheusbgodoi/local-photo-ai-m5.git
cd local-photo-ai-m5
./scripts/install.sh
```

That installs Draw Things.app and `draw-things-cli` via Homebrew, builds the
project, links the `local-photo` command, downloads the model, installs the Pi
extension and registers the MCP server, then runs a smoke test.

| flag | effect |
| --- | --- |
| *(none)* | engine + model + CLI + Pi + MCP |
| `--full` | also the upscaler weights, Playwright and the realism LoRA |
| `--no-model` | skip the multi-gigabyte download |
| `--skip-brew` | do not touch Homebrew |

It is idempotent — re-running it is the supported way to repair an install.

Requirements: Apple Silicon, macOS 13+, Node 22+, ~12 GB free disk (~25 GB for
`--full`).

### Where things live

| what | where |
| --- | --- |
| weights | `~/Library/Application Support/local-photo-ai-m5/models` |
| config overrides | `~/Library/Application Support/local-photo-ai-m5/config.json` |
| default output | `<cwd>/.local-photo/` |
| Pi extension | `~/.pi/agent/extensions/local-photo/` |

Weights deliberately do **not** live in Draw Things' own sandbox container:
that directory is protected by macOS and a non-sandboxed CLI cannot write to
it. See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

---

## Using it

### From the terminal

```bash
local-photo generate "médica conversando com paciente idoso" --preset clinical

local-photo generate "MacBook aberto sobre mesa de escritório real" \
  --preset product --output ./public/assets/hero.jpg

local-photo generate "família na cozinha" \
  --preset lifestyle --size post-portrait --count 4

local-photo generate "recepção de uma clínica" --upscale off   # raw only
```

The brief is a positional argument. `--prompt` / `-p` mean the same thing and
keep working, so nothing already scripted against them breaks.

Every command explains itself:

```bash
local-photo --help
local-photo generate --help      # or: local-photo help generate
local-photo prompt -h
```

| command | what it does |
| --- | --- |
| `generate` | make a photograph |
| `prompt` | show the brief without generating |
| `upscale` | enlarge an image conservatively |
| `reproduce` | re-run a generation from its `.json` sidecar |
| `health` | one-line readiness check |
| `doctor` | full diagnostic report |
| `benchmark` | measure variants / LoRA / upscale on this machine |
| `lora` | `list · info · enable · disable · install` |
| `verify` | check installed weights against the manifest checksums |
| `prune` | delete weights the selected configuration does not use |
| `serve` | report warm-server status (never starts one) |
| `install-model` · `install-upscaler` | fetch weights |
| `render-html` | HTML/CSS → PNG at exact dimensions |
| `presets` · `sizes` · `manifest` | what is available |

### From Pi

```bash
cd ~/src/cluemed
pi
```

> Crie uma foto realista de uma médica atendendo uma idosa que combine com
> essa landing page e coloque no hero.

Pi reads the repo, understands the identity, writes the intent, calls
`image_generate`, gets an absolute path back and edits the HTML. It never sees
a checkpoint name. See [docs/PI.md](docs/PI.md).

### From an MCP client

```bash
claude mcp add local-photo -- node "$PWD/dist/mcp/server.js"
```

Tools: `image_generate`, `image_upscale`, `image_health`,
`image_prompt_preview`. See [docs/MCP.md](docs/MCP.md).

### Presets

| preset | for |
| --- | --- |
| `natural` *(default)* | plausible everyday photography |
| `professional` | commissioned commercial work that still reads as real |
| `lifestyle` | candid, in-the-moment |
| `clinical` | healthcare documentary, not medical advertising |
| `product` | a real object on a real surface |
| `smartphone` | a snapshot from someone's camera roll |

Six, not twenty. A photographer does not have twenty modes either.

---

## Realism LoRA

Supported, generic, and **off by default** — because the raw model plus a good
brief is already the baseline to beat, and an adapter that "adds detail" is not
the same as an adapter that adds realism.

That is a measured conclusion, not a preference. A 24-frame A/B across doctors,
elderly subjects and products found the installed realism adapter moves *tone*
rather than texture: warmer, and progressively smoother skin as strength rises.
On a 40-year-old face at 0.6 it visibly softens exactly what should stay. See
[docs/BENCHMARK.md](docs/BENCHMARK.md#realism-lora--the-ab).

```bash
local-photo lora list
local-photo lora install realstagram-zimg
local-photo lora enable realstagram-zimg --strength 0.4
local-photo lora disable
```

A LoRA cannot be enabled unless its licence has been verified to permit
commercial use — that is enforced in code, not just documented. The A/B
results and the licence table are in [docs/MODELS.md](docs/MODELS.md) and
[docs/BENCHMARK.md](docs/BENCHMARK.md).

---

## Upscaling

**Lanczos 1.5× is the default, and it is the only upscaler that is.** Lanczos
is a pure resample: it invents nothing, so it cannot invent artefacts. Every
generation therefore delivers two files:

```
./assets/doctor.jpg        the Lanczos 1.5x final artifact  ← the main result
./assets/doctor.raw.jpg    the model's own frame, unscaled and unfinished
./assets/doctor.json       the sidecar, referencing both by absolute path
```

The path you ask for is always the **final** artifact; the raw render is kept
beside it and is never overwritten. The raw file is the frame the model
produced, at the size it produced it — with no `--size` it is byte-identical to
what `--upscale off` would have delivered, and with one it stays at the
generation size while only the final is resized to the delivery dimensions.
Either way nothing is lost by having the default on.

```bash
local-photo generate "..."                    # Lanczos 1.5x + raw (default)
local-photo generate "..." --upscale off      # the raw render alone, one file
local-photo generate "..." --upscale auto     # only when it would actually enlarge
local-photo generate "..." --upscale-scale 2  # a different factor
local-photo upscale hero.jpg --scale 1.5      # after the fact
```

`auto` exists so an agent can ask for it safely: it upscales only when the
delivery size is meaningfully larger than what the model produced. Going from
1024px to 1080px is a resample, not an upscale, and running a generative pass
for a 5 % difference only risks artefacts.

**AI upscalers stay non-default.** "More detail" is not "more real": a
generative upscaler will happily give an elderly woman a uniform field of
manufactured pores. Routes, in increasing order of risk: Lanczos resample
(invents nothing), Real-ESRGAN 2x/4x, SeedVR2 generative restoration — the last
two only when you ask for them by name.

Measured here on elderly skin — the hardest case: **Lanczos 1.5× is
indistinguishable from the source**, while **Real-ESRGAN 2× in 21 s makes it
worse** — stringy hair, etched crepe-like skin, invented structure in the
background. Sharper, and less photographic. Details in
[docs/BENCHMARK.md](docs/BENCHMARK.md#upscaling--lanczos-vs-real-esrgan).

Cost of having it on, measured on this machine at the same seed (1024² frame,
clinical preset): **+0.37 s** of wall time — 0.18 s of Lanczos, 0.10 s to write
the raw render, 0.08 s for the larger final encode — against a ~39 s
generation. Run-to-run variance in the backend alone is larger than that.

---

## HTML/CSS workflow

```
image_generate → asset → your HTML/CSS → render → 1080×1350 PNG
```

```bash
local-photo render-html post.html -o post.png --width 1080 --height 1350
```

A complete worked example lives in [`examples/clinic-demo/`](examples/clinic-demo/).

---

## Reproducibility

Every generation writes a sidecar:

```jsonc
{
  "file":     "/abs/path/hero.jpg",      // the delivered artifact
  "raw_file": "/abs/path/hero.raw.jpg",  // the model's own frame, null if --upscale off
  "prompt_original": "médica conversando com paciente idosa",
  "prompt_enhanced":  "A photograph taken during an ordinary working day…",
  "preset": "clinical", "model_variant": "i8x",
  "lora": null, "seed": 1837462, "steps": 8, "guidance": 1,
  "width": 1536, "height": 1536,         // what the file is
  "gen_width": 1024, "gen_height": 1024, // what the model was asked for
  "upscaled": true, "upscaler": "lanczos", "upscale_scale": 1.5,
  "rationale": ["Scene: people=two, ages=[elderly], …"]
}
```

```bash
local-photo reproduce hero.json
```

Same seed, same settings, same brief. Measured on this machine, a reproduce run
came back **bit-identical** — 0 difference across every channel. That holds for
the same Draw Things build on the same hardware; the project does not promise
it across versions or machines, because Draw Things does not.

---

## Licensing

The project code, original documentation and committed example images are
released under the [MIT License](LICENSE). Model weights are not included.

Every external component's licence is recorded in
[`config/models.json`](config/models.json) with the source it was read from,
and a `commercial_use_verified` flag. Anything unverified is refused by the
code, not merely flagged. Full table: [docs/MODELS.md](docs/MODELS.md).

---

## Privacy

Prompts and images never leave the machine during inference. No cloud
fallback. Any local service binds to `127.0.0.1` only. Nothing starts at login,
nothing runs as a daemon, and idle memory cost is zero.

---

## Troubleshooting · Update · Uninstall

```bash
local-photo doctor          # what is wrong
git pull && ./scripts/install.sh   # update (idempotent)
./scripts/uninstall.sh      # remove integrations, keep weights
./scripts/uninstall.sh --all       # offer to remove weights too
```

[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
