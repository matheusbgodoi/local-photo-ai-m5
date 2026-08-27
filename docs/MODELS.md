# Models and licences

**Verified 2026-08-16.** Every licence below was read from a primary source on
that date, and the source is named. Nothing here is inferred from a model's
reputation or from a third-party summary.

The machine-readable version is [`config/models.json`](../config/models.json).
The `commercial_use_verified` flag in that file is **enforced in code**:
`assertCommerciallyUsable()` throws before a component whose commercial use is
unverified can be installed or enabled. It is not a comment.

---

## Why this file exists

These images end up in company marketing. A model whose licence forbids
commercial use is not "probably fine" — it is a liability with a filename. So
the rule is:

> If the licence cannot be verified to permit commercial use of the generated
> images, the component does not enter the production pipeline. Not as a
> default, not as an option, not "temporarily".

The fallback when that happens is always available and always supported:
**raw Z-Image Turbo + the photography prompt engine.**

---

## Generator

### Z-Image Turbo 1.0 — **in use**

| | |
| --- | --- |
| upstream | [`Tongyi-MAI/Z-Image-Turbo`](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo) |
| licence | **Apache-2.0** |
| source of that claim | HuggingFace model card metadata, `license: apache-2.0` |
| commercial use | **verified — permitted** |
| distributed via | Draw Things official model catalog |

Apache-2.0 grants commercial use, modification and redistribution with
attribution and a patent grant. There is no additional acceptable-use rider in
the model card frontmatter.

> One caveat worth recording honestly: the HuggingFace repository has no
> standalone `LICENSE` file. The Apache-2.0 grant is asserted through the model
> card metadata and the HF licence tag. That is the normal HF convention and is
> what the platform surfaces as the licence, but it is metadata rather than a
> signed document in-tree.

#### Variants

All four are the same weights at different precisions. Sizes and checksums are
from Draw Things' own `ModelZoo`.

| id | file | quantisation | catalog |
| --- | --- | --- | --- |
| `q8p` | `z_image_turbo_1.0_q8p.ckpt` | 8-bit palettised | official |
| `i8x` | `z_image_turbo_1.0_i8x.ckpt` | 8-bit S (fused int8 matmul) | official |
| `q6p` | `z_image_turbo_1.0_q6p.ckpt` | 6-bit palettised | official |
| `f16` | `z_image_turbo_1.0_f16.ckpt` | float16, exact | community |

Which one this machine selected, and why, is in [BENCHMARK.md](BENCHMARK.md).

#### Companion files

Shared by every variant, downloaded once:

| file | role | size |
| --- | --- | --- |
| `qwen_3_vl_4b_instruct_q8p.ckpt` | text encoder | 4.53 GB |
| `flux_1_vae_f16.ckpt` | autoencoder | 0.17 GB |

The text encoder being a Qwen 3 VL model is why Z-Image handles long, natural,
sentence-shaped prompts well — which is exactly what the photography engine
produces. It is also why Portuguese renders at all, though English still gives
noticeably more precise photographic control.

### Not installed, on purpose

FLUX.2 Klein, FLUX.1, SDXL, Qwen-Image, Krea, Ideogram. Each would be several
more gigabytes and another set of quirks to learn. One model understood deeply
beats six understood shallowly, and the brief asks for photography, not
breadth.

---

## Realism LoRAs

### Realstagram (`REALSTAGRAM_ZIMG`) — **installed, evaluated**

| | |
| --- | --- |
| creator | brandodio (Civitai) / diobrando0 (HuggingFace) |
| base model | Z-Image Turbo |
| file | `REALSTAGRAM_ZIMG.safetensors`, 340,220,400 bytes, rank 64, BF16 |
| sha256 | `f48df7097d62803e7440c7cf2255224a7e9b037356eb31b395867bfab904be5f` |
| **HuggingFace licence** | **Apache-2.0** (model card frontmatter) |
| **Civitai flags** | `allowCommercialUse: ["Image","RentCivit","Rent","Sell"]`, `allowNoCredit: true`, `allowDerivatives: true` |
| commercial use | **verified — permitted by both routes** |
| author's strength | 0.2 – 0.6 |
| trigger words | none |

Two independent grants agree, and the HuggingFace mirror needs no account,
which is why this is the adapter the project can actually download, test and
ship. The mirrored file's checksum matches the Civitai-recorded checksum
exactly, so they are the same weights.

The author describes it as a *subtle* realism pass designed to preserve
Z-Image's native composition and lighting rather than override it — which is
much closer to what this project wants than a LoRA that imposes a look.

**Verdict after a 24-frame A/B on this machine: off by default.** It moves
*tone*, not texture — warmer, and progressively smoother skin as strength
rises. On a 40-year-old doctor at 0.6 the face is visibly softened; on elderly
subjects and products it changes nothing worth having. That is a faithful
"amateur Instagram" look and a poor fit for documentary clinical work.

It stays installed and one command away:

```bash
local-photo lora enable realstagram-zimg --strength 0.4
```

Full comparison, including the 100 % crops it was judged on, in
[BENCHMARK.md](BENCHMARK.md#realism-lora--the-ab).

### Realistic Snapshot — ZIT v5 (Real Life) — **licence clear, not installed**

| | |
| --- | --- |
| creator | MonkeyForever |
| Civitai | model `2268008`, version `2617751` |
| file | `RealisticSnapshot-Zimage-Turbov5.safetensors`, 162 MB |
| sha256 | `182d7f92475b8d7f792203127738d31270403e86e007fdc7792d324a3406e556` |
| flags | `allowCommercialUse: ["Image","RentCivit","Rent","Sell"]`, `allowNoCredit: true`, `allowDerivatives: true` |
| commercial use | **verified — permitted** |
| author's strength | 0.60 – 0.70 |

Licence is clean and it is the highest-profile realism adapter for this base
model. It is **not installed** for one practical reason: Civitai now returns
`401 Unauthorized` for this creator's downloads without an account token, and
no `CIVITAI_TOKEN` is configured on this machine.

To evaluate it:

```bash
echo "CIVITAI_TOKEN=..." >> .env          # from civitai.com/user/account
local-photo lora install realistic-snapshot-zit-v5
local-photo benchmark --suite lora
```

One caution to carry into that evaluation: the author's own release notes for
earlier versions emphasise faces and "different girls". This project's subjects
are doctors, elderly patients, families, men and products, so it must be judged
on those, not on a portrait.

### Amateur Photography — **REJECTED**

| | |
| --- | --- |
| creator | peterkickasspeter |
| Civitai | model `652699` |
| flags | `allowCommercialUse: ["RentCivit"]`, `allowNoCredit: false`, `allowDerivatives: false` |
| commercial use | **NOT permitted** |

`allowCommercialUse` does not contain `"Image"`. Commercial use of generated
images is not granted. That alone disqualifies it here, and the code refuses to
install or enable it.

Two secondary reasons it would have lost anyway: its published Z-Image builds
target Z-Image **Base**, not Turbo; and the author's own version notes report a
strong skin-tone bias in the dataset, which is disqualifying for a project that
photographs Brazilian patients and families.

### Midjourney Luneva Cinematic — **available as a style, never a realism default**

| | |
| --- | --- |
| Civitai | model `2185167`, version `2460437` · 649 MB |
| flags | `allowCommercialUse: ["Image","RentCivit"]`, **`allowNoCredit: false`**, `allowDerivatives: false` |
| commercial use | permitted — **but credit is required** |

Commercial image use is granted, so it could be offered as an explicit
`cinematic` style. It will never be the realism default: cinematic grading is
the precise aesthetic this project exists to avoid.

**If you enable it, you must credit the creator in the published work** —
`allowNoCredit: false` is a condition, not a preference.

### Luneva Cyber + HD Enhancer — **not recommended, not installed**

| | |
| --- | --- |
| Civitai | model `2215818`, version `2494657` · 649 MB |
| flags | `allowCommercialUse: ["Image","RentCivit"]`, `allowNoCredit: false` |

Licence would allow it with credit. It is excluded on quality grounds: it is a
strong sci-fi/PBR styliser. Applying it to doctors and families produces
exactly the artificial look the whole project is built to avoid.

---

## Upscalers

| id | licence | commercial | status |
| --- | --- | --- | --- |
| `lanczos` (sharp/libvips) | Apache-2.0 / MIT | ✅ | **default** |
| `realesrgan-x2` | BSD-3-Clause | ✅ | available |
| `realesrgan-x4` | BSD-3-Clause | ✅ | available |
| `seedvr2-3b` | Apache-2.0 | ✅ | available |
| `seedvr2-7b` | Apache-2.0 | ✅ | available |
| `4x-ultrasharp` | **CC-BY-NC-SA-4.0** | ❌ | **REJECTED** |
| `remacri-4x` | **CC-BY-NC-SA-4.0** | ❌ | **REJECTED** |

4x-UltraSharp and Remacri are both popular and both **non-commercial**. They
ship inside Draw Things' upscaler zoo, which makes them easy to reach for by
accident. They are recorded here specifically so that does not happen: the code
refuses them.

SeedVR2 (ByteDance-Seed, Apache-2.0) is a *generative restorer*, not a member
of Draw Things' upscaler zoo — it cannot be reached through the `upscaler`
config key and instead runs as an image-to-image pass. That distinction is
implemented in `service.applyUpscale()`.

---

## How to verify any of this yourself

```bash
# Model licence, straight from the source
curl -s https://huggingface.co/api/models/Tongyi-MAI/Z-Image-Turbo | jq .cardData.license

# Civitai permission flags for any LoRA
curl -s https://civitai.com/api/v1/models/2268008 \
  | jq '{allowCommercialUse, allowNoCredit, allowDerivatives, allowDifferentLicense}'

# What this project currently believes
local-photo manifest | jq '.loras[] | {id, license, commercial_use_verified}'
local-photo lora list
```

If a licence changes upstream, this file and `config/models.json` are what need
updating — and `verified_at` should move with them.
