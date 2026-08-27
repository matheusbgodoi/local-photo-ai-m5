# Benchmark

Everything here was measured on the machine named below. No number in this file
came from a blog post, a vendor page or another Mac.

```
Apple M5 · 10 cores (4 performance + 6 efficiency) · 24 GB unified memory
macOS 27.0 (build 26A5406e)
Draw Things 1.20260716.0 · draw-things-cli 1.20260716.0 (Homebrew)
Z-Image Turbo 1.0, 1024×1024, 8 steps, CFG 1.0
```

**Caveat that applies to every timing below:** the machine was not idle. A
model download ran through most of these measurements and ~13 GB was already in
use by a browser, editors and this session. Absolute numbers are therefore
pessimistic. Comparisons *between rows* are still fair — each table was
measured under the same conditions in a single run.

Reproduce any of it:

```bash
local-photo benchmark --suite variants
local-photo benchmark --suite lora
local-photo benchmark --suite realism
```

---

## How to read the timings

**Every generation loads the model.** On-demand means one process per image,
which exits afterwards; there is no resident model to reuse. What varies is
whether the weights are still in the OS page cache:

| | measured |
| --- | ---: |
| very first generation after install (cold page cache) | **74.7 s** |
| subsequent generations (weights cached by macOS) | **48–58 s** |
| of which: sampling, 8 steps | ~53 s first run, avg 6.6 s/step |

So the model-load overhead on a warm page cache is small; the sampling itself
dominates. This is what makes a warm server much less attractive than it looks
— see [Warm mode](#warm-mode) below.

---

## Realism LoRA — the A/B

`local-photo benchmark --suite lora --scenarios medical,elderly,laptop`
— 24 frames, 3 scenarios × 2 seeds × 4 configurations.

### The numbers

| configuration | runs | first call | median | slowest | peak Δmem | swap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| raw | 6 | 51.8 s | 52.6 s | 58.6 s | 5.70 GB | 1850 MB |
| + realstagram @0.25 | 6 | — | 51.7 s | 57.5 s | 5.60 GB | 1948 MB |
| + realstagram @0.40 | 6 | — | 51.8 s | 56.0 s | 5.50 GB | 1954 MB |
| + realstagram @0.60 | 6 | — | 53.5 s | 55.1 s | 5.60 GB | 1954 MB |

Cost is effectively free: a 340 MB rank-64 adapter adds no measurable time and
no measurable memory. So the decision is entirely about what it does to the
picture.

*(These runs shared the machine with an ongoing model download, so absolute
times run slightly high. The comparison between rows is still fair — every row
was measured under the same conditions.)*

### The verdict: **raw wins. LoRA off by default.**

Judged on 100 % crops of the same face region, same seed, one variable:

| scene | what the adapter did |
| --- | --- |
| **medical** (doctor, ~40, mid-distance) | **worse.** Progressively smoother skin and a warmer cast as strength rises. At 0.6 the face is visibly softened — the opposite of what this project wants. |
| **elderly** (two older women at home) | **no difference worth having.** All four are near-identical; raw has marginally more local contrast. |
| **laptop** (product) | **no effect.** As expected — it is a portrait-oriented adapter. |
| **young portrait** (its home turf) | **a wash.** Teeth marginally less uniform with the adapter, eyes marginally better without. Nothing decides it. |

The pattern across all four: **Realstagram moves tone, not texture.** It warms
the image and smooths skin. That is a real "amateur Instagram" look and the
author describes it honestly as such — it simply is not the look this project
needs, and on older faces it actively removes the thing that makes them read as
photographs.

This is exactly the case rule 71 of the brief anticipates: infrastructure
supports the adapter, quality decides whether it runs, and here quality says no.

```bash
# It stays installed and one command away, for anyone who wants the warmer look
local-photo lora enable realstagram-zimg --strength 0.4
local-photo lora disable
```

### Not tested: Realistic Snapshot ZIT v5

Licence is clean (see [MODELS.md](MODELS.md)) but Civitai returns `401` for that
creator's downloads without an account token, and none is configured here. To
finish the comparison:

```bash
echo "CIVITAI_TOKEN=..." >> .env
local-photo lora install realistic-snapshot-zit-v5
local-photo benchmark --suite lora
```

---

## Upscaling — Lanczos vs Real-ESRGAN

Source: an `elderly` frame at 1024×1024. Elderly skin is the hardest test there
is, because every upscaler's failure mode shows up there first.

| route | time | output | verdict |
| --- | ---: | ---: | --- |
| **Lanczos 1.5×** | **0.4 s** | 1536×1536 | **default.** Indistinguishable from the source at matched subject scale. Invents nothing, so it cannot invent artefacts. |
| Real-ESRGAN 2× | 21.3 s | 2048×2048 | **do not use on faces.** |

Real-ESRGAN produced a visibly *sharper* and visibly *less photographic*
result:

- hair became stringy, with hard wiry edges instead of soft strands
- skin gained an etched, crepe-like texture — the wrinkles are over-defined and
  the cheek looks carved rather than lit
- the background curtain grew vertical structure that is not in the source

That is textbook over-sharpening dressed as detail, and it is precisely the
failure rule 31 of the brief describes. "More detail" is not "more real."

**Lanczos 1.5× is therefore the default delivery path**, and the only upscaler
that is on by default. It is a resample, not a model: it invents nothing, so
there is no artefact for it to invent, and the measurement above is what makes
that claim rather than an assumption. The model's own frame is kept next to the
delivered file as `<name>.raw.<ext>` at the generation size — byte-identical to
what `--upscale off` produces whenever no delivery `--size` is in play — so the
unscaled render is never lost and the decision stays reversible after the fact.

Measured cost of having it on, same seed, 1024² frame, clinical preset:

| step | time |
| --- | ---: |
| Lanczos 1.5× resample | 0.18 s |
| writing the raw render | 0.10 s |
| larger final encode | 0.08 s |
| **total added** | **0.37 s** |

Against a ~39 s generation, that is under 1 % — less than the run-to-run
variance of the backend itself.

Real-ESRGAN and SeedVR2 remain **non-default**, available for material where
they help — signage, screens, hard-edged product shots — and a poor idea on
anything with skin in it.

SeedVR2 (3B, Apache-2.0) is in the manifest and installable but was not
measured here; the disk and bandwidth went to the model variants first.

```bash
local-photo install-upscaler seedvr2-3b
local-photo upscale hero.jpg --scale 1.5 --upscaler seedvr2-3b
```

---

## Memory

| state | measured |
| --- | ---: |
| idle, before any generation | 12.7 – 14 GB in use (browser, editors, this session) |
| peak above idle, 1024² generation | **+4.4 – 6.3 GB**, depending on variant |
| — `i8x` (the default) | +5.8 GB |
| — `q8p` | +6.3 GB |
| — `q6p` | +5.5 GB |
| swap during generation | 1.5 – 2.6 GB |
| after the process exits | back to idle — nothing resident |

That peak is the whole point of the on-demand design: between generations this
project costs nothing at all.

Swap does move during a run. Note the starting point: this machine already had
12.7–14 GB in use before any generation, so the 24 GB budget was tight before
the model was even loaded, and a model download was running concurrently for
some of these measurements. On an otherwise quiet machine the swap figure would
be lower.

---

## Warm mode

Not enabled, and the numbers explain why.

Model load on a warm page cache is a small fraction of a ~50 s generation. A
warm server would buy back a few seconds per image at the cost of keeping
~6 GB resident permanently — on a 24 GB machine that is a poor trade for an
occasional-use tool.

It is supported when you want it:

```bash
local-photo serve            # is a server listening?
local-photo serve --use      # route generations to it
local-photo serve --off      # back to on-demand
```

The server itself is never started by this project. Draw Things' gRPC server is
not distributed by the Homebrew formula (it has to be built from
draw-things-community), and the app's own API server is a GUI toggle in
Advanced — which this project does not automate, by design. Loopback is
enforced in code, not merely defaulted.

---

## Reproducibility

```bash
local-photo reproduce photo.json
```

Measured: a reproduce run of a `--count 3` frame came back **bit-identical** to
the original — mean absolute difference 0.000/255, max channel difference 0.

That is the same Draw Things build on the same machine. The sidecar records the
generation size separately from the delivery size (`gen_width`/`gen_height` vs
`width`/`height`) precisely so the replay asks the model for the same canvas
rather than the resampled one.

---

## Model variant selection

The four variants of Z-Image Turbo 1.0 in the Draw Things catalog:

| variant | file | download | on-disk | notes |
| --- | --- | ---: | ---: | --- |
| `q8p` | `z_image_turbo_1.0_q8p.ckpt` | 5.94 GB | 5.94 GB | 8-bit palettised, official — **in use** |
| `i8x` | `z_image_turbo_1.0_i8x.ckpt` | 5.76 GB | 5.76 GB | 8-bit S, fused int8 matmul, official |
| `q6p` | `z_image_turbo_1.0_q6p.ckpt` | 4.53 GB | 4.53 GB | 6-bit palettised, official |
| `f16` | `z_image_turbo_1.0_f16.ckpt` | 11.49 GB | 11.49 GB | float16 exact, community |

All four share one text encoder (`qwen_3_vl_4b_instruct_q8p.ckpt`, 4.53 GB) and
one autoencoder (`flux_1_vae_f16.ckpt`, 0.17 GB), downloaded once.

### Measured: 18 frames, 3 scenarios × 2 seeds × 3 variants

| variant | runs | first call | median | slowest | peak Δmem | swap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `q8p` | 6 | 50.8 s | 54.0 s | 56.0 s | 6.30 GB | 2629 MB |
| **`i8x`** | 6 | **39.3 s** | **38.5 s** | **41.2 s** | **5.80 GB** | 2631 MB |
| `q6p` | 6 | 52.0 s | 53.0 s | 53.7 s | 5.50 GB | 2632 MB |

### Verdict: **`i8x` — Z Image Turbo 1.0 (8-bit S)**

**Quality is a tie.** At 100 % on the same face, the same seed, all three are
indistinguishable: identical skin texture, identical detail, sub-perceptual
differences in warmth. Quantisation shifts the sampling trajectory slightly, so
framing moves a few pixels between variants, but nothing about the *photograph*
changes. Same result on the product and elderly scenes.

So the brief's criteria fall through to the next ones, and `i8x` wins both:

- **29 % faster** than `q8p` — 38.5 s median against 54.0 s
- **less memory** — 5.80 GB peak against 6.30 GB

That speed gap is not noise. `i8x` is the "8-bit S" build, which uses a fused
int8 matmul, and Metal Quantized Attention is enabled by default on M5
specifically. This variant is the one the hardware was built for, and this
machine is the hardware.

`q6p` was not chosen despite using the least memory (5.50 GB): it is a more
aggressive quantisation, it is *slower* than `i8x`, and it has no quality
argument in its favour. With 24 GB there is no reason to compress harder for a
0.3 GB saving. It stays in the manifest for a machine where memory is tighter.

```bash
local-photo benchmark --suite variants           # re-run the comparison
local-photo benchmark --suite variants --apply q6p
```

### `f16` (float16, exact) — measured, and rejected

f16 does **not** share the quantised builds' text encoder. It needs
`qwen_3_vl_4b_instruct_f16.ckpt` instead: another 8.06 GB, putting its total
footprint at roughly **21 GB of model data on a 24 GB machine**.

Measured against `i8x`, same scenes, same seeds, same run:

| variant | runs | first call | median | slowest | peak Δmem | swap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **`i8x`** | 4 | 36.7 s | **38.2 s** | 38.5 s | 4.80 GB | **2635 MB** |
| `f16` | 4 | 59.6 s | 56.3 s | 59.6 s | 5.30 GB | **6617 MB** |

- **Quality: indistinguishable.** At 100 % on the same face, f16 shows the same
  skin texture and the same detail as the 8-bit build. Slightly warmer, and the
  framing shifts because the trajectory differs — nothing that reads as better.
- **Speed: 47 % slower** — 56.3 s against 38.2 s.
- **Memory: it made the machine page.** Swap went from 2.6 GB to 6.6 GB *the
  moment the f16 runs started*, and macOS grew the swap file to accommodate it.

The brief's rule for the exact build is that it survives only if quality
improves **materially** *and* memory pressure stays acceptable. It fails both.
`i8x` stands.

### Reclaiming the disk

Benchmarking all four leaves ~22 GB of unused weights behind:

```bash
local-photo prune          # what would go
local-photo prune --yes    # 21.96 GB freed here
```

---

## Sampling steps

The model card recommends 9. Measured on `i8x`, same prompt, same seed:

| steps | time | what changed |
| --- | ---: | --- |
| 6 | 30.9 s | face indistinguishable; slightly less background detail |
| **8** | **38.1 s** | **default** |
| 9 | 42.9 s | no visible gain on the face; different background objects |
| 12 | 54.3 s | no visible gain; 42 % slower than 8 |

The surprise: on a distilled turbo model, step count mostly changes *which
scene* the sampler lands on rather than how good it looks. All four faces have
the same skin quality. The background props differ — a mug at 6, a camera at 8,
a stack of paperwork at 9 — because the trajectory changes.

So 8 stays the default: it is the model's design point and 9 buys nothing here.
**6 is genuinely usable** and 19 % faster, which is worth knowing when iterating:

```bash
local-photo generate -p "..." --steps 6      # drafting
local-photo generate -p "..." --seed <n>     # then commit to a seed at 8
```

---

## Realism scenarios

`local-photo benchmark --suite realism` runs all ten. What each is for, and
what to look at, is in [`bench/README.md`](../bench/README.md).

Findings that came out of running them:

- **Say the nationality.** The single largest quality lever found in this whole
  project. See [PHOTOGRAPHY.md](PHOTOGRAPHY.md#say-who-is-in-the-picture).
- **Products are easy, faces are the test.** Laptop and phone scenes were
  consistently plausible; every meaningful difference between configurations
  showed up on skin.
- **"casal idoso" renders as two women about as often as a couple.** The model
  reads "elderly couple" loosely. If the pairing matters, say it: *"um homem
  idoso e uma mulher idosa"*.
- **Hands held up.** Across the frames judged here, hands were anatomically
  correct — including a nurse mid-gesture with both hands raised, which is the
  case that usually fails.
