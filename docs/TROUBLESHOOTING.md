# Troubleshooting

Start here:

```bash
local-photo doctor
```

It prints platform, engine, model, LoRA, upscaler, integration and
configuration state in one screen, and tells you the command that fixes each
failure.

---

## Installation

### `Operation not permitted` writing to the Draw Things models directory

**Symptom**

```
Error: You don't have permission to save the file "…" in the folder "Models".
ls: ~/Library/Containers/com.liuliu.draw-things/…/Models: Operation not permitted
```

**Cause.** `~/Library/Containers/com.liuliu.draw-things/` is Draw Things'
macOS app sandbox container. It is protected by TCC, and a non-sandboxed
process — `draw-things-cli`, your shell, this project — cannot write into it
without Full Disk Access.

**Fix.** Nothing: this project already keeps its weights outside the container.

```
~/Library/Application Support/local-photo-ai-m5/models
```

`draw-things-cli` is pointed there with `--models-dir` on every call, so both
the CLI and the app work — they simply keep separate model directories.

If you *want* Draw Things.app to see the same weights, open the app and point
its models directory at the path above through its own file picker. The sandbox
grants access to folders the user selects, which is why that route works when
writing directly does not.

If an aborted download left a `.partial` file inside the container that you
cannot delete, grant your terminal Full Disk Access in System Settings →
Privacy & Security, or delete it from Finder.

### `draw-things-cli: command not found`

```bash
brew install draw-things-cli
```

Homebrew's formula (`draw-things-cli` in homebrew-core) is the one to use. Do
not substitute the custom tap or `--HEAD`: they can install an older build
whose `generate` subcommand is missing flags this project relies on.

### The version reported looks wrong

`draw-things-cli --version` prints the literal string `dev`, even for the
released Homebrew bottle. It is not a real version. Use:

```bash
brew list --versions draw-things-cli
```

`local-photo doctor` already does this.

### The model download is slow

`static.libnnc.org` throttles. Expect a long single download for the first
model — it is roughly 11 GB in total, because a variant also pulls a 4.5 GB
text encoder and a 0.2 GB autoencoder that every other variant then reuses.

It resumes. Re-running `local-photo install-model` continues from the partial
file rather than starting over, and the installer is safe to re-run at any
time.

---

## Generation

### `Z-Image Turbo … is not installed`

```bash
local-photo install-model
```

Check where it is looking:

```bash
local-photo doctor | grep "models dir"
```

`LOCAL_PHOTO_MODELS_DIR` overrides the default, which is useful for putting
weights on an external volume.

### `Generation produced an unusable image`

The sanity check caught a blank, black or featureless frame and refused to hand
it back. Usually a transient backend failure. Retry with a different seed; if
it repeats, run the backend directly to see its own error:

```bash
draw-things-cli generate \
  --models-dir "$HOME/Library/Application Support/local-photo-ai-m5/models" \
  --model z_image_turbo_1.0_q8p.ckpt \
  --prompt "a cup of coffee on a desk" --steps 8 --cfg 1 \
  --width 512 --height 512 --output /tmp/t.png
```

### Faces look plastic

Before reaching for a LoRA, check the prompt. Any of these in your own text
will fight the engine:

```
ultra realistic · 8k · masterpiece · perfect skin · flawless · award winning
highly detailed · sharp focus · cinematic · HDR
```

The engine never adds them; it does not strip them from *your* text, because
rewriting your request is not its job. It does flag them — look at
`rationale` in the sidecar JSON, or:

```bash
local-photo prompt "your prompt here"
```

Then: is the framing close enough for skin texture to matter? The engine only
emits pore-level language for portrait and close-up framing, because at a
medium distance the model renders that as noise rather than skin.

### Hands, teeth, or a person with the wrong number of limbs

Z-Image Turbo is good but not immune. Practical mitigations, in order:

1. generate `--count 4` and pick — cheaper than fighting one seed
2. reduce scene complexity; four people mid-gesture is harder than two talking
3. avoid framings that put hands in the foreground unless you need them
4. `--preset natural` or `clinical` rather than `lifestyle` for calmer poses

### Output is not the size I asked for

Diffusion runs at a model-friendly, stride-64 size on the requested aspect, and
the result is resampled to the delivery dimensions. Asking the model directly
for 1080×1920 produces stretched faces. `local-photo sizes` lists the presets;
`--width/--height` still works and is snapped to the stride.

With no size given, the delivered file is the Lanczos 1.5× of the generation
size — 1536×1536 from a 1024×1024 frame. A named `--size` still wins: the
delivery dimensions are honoured whether or not the upscale ran.

### The brief came out half in Portuguese

Read the rationale — `local-photo prompt "<brief>"` prints it for free:

```
Translated pt-BR -> EN (72% of content words recognised); kept verbatim: <words>
```

Words listed there are not in the dictionary and were passed through untouched
rather than guessed at. Either say them in English, or add them to `PHRASES` /
`WORDS` in `src/core/prompt/translate.ts` — it is a plain dictionary, offline
and deterministic, and adding a term is a two-line change plus a test.

The same rationale is where a misread scene shows up. A `products=` or
`framing=` value the brief never asked for means the engine misunderstood
before the model ever ran, which needs a different fix than a bad generation.

### `A brief is required`

The brief is a positional argument; `--prompt` / `-p` do the same thing.

```bash
local-photo generate "médica conversando com paciente idosa"
local-photo generate --prompt "médica conversando com paciente idosa"
local-photo generate --help      # or: local-photo help generate
```

---

## LoRA

### `is not cleared for commercial use, so it cannot be enabled`

Working as intended. The manifest records that component's licence as not
permitting commercial use of generated images, and this project ships marketing
assets. See [MODELS.md](MODELS.md).

### `Civitai downloads require an API token`

```bash
echo "CIVITAI_TOKEN=..." >> .env      # from civitai.com/user/account → API Keys
```

`.env` is git-ignored. Some creators require an account for downloads; others
do not. Where a licence-clean mirror exists (HuggingFace, for example), the
manifest records it and no token is needed.

### `Checksum mismatch`

The downloaded file is not what the manifest recorded. That is a hard failure
on purpose — the file is deleted rather than installed. Either the upstream
version was republished (update `config/models.json` and `verified_at`) or the
download was corrupted.

### The LoRA has no visible effect

Draw Things needs the base-model family for adapters that are not registered in
its own `custom_lora.json`; without it the adapter is silently ignored. This
project always passes it (`version: "z_image"`), so if you added a LoRA by
hand, check that. Also try a higher strength — 0.25 is genuinely subtle.

---

## Upscaling

### I asked for one file and got two

That is the default, and both are yours:

```
hero.jpg       the Lanczos 1.5x final artifact  <- what --output named
hero.raw.jpg   the model's own frame, unscaled and unfinished
```

The path you asked for is always the final one. To get a single file, turn the
enlargement off:

```bash
local-photo generate "..." --upscale off
```

`hero.raw.jpg` is the frame at the size the model made it. With no `--size` that
is byte-identical to what `--upscale off` would have written; with a `--size`
that carries delivery dimensions, only the final file is resized to them and the
raw stays at the generation size. You can delete it whenever you like without
losing anything reproducible — the sidecar records the seed either way.

### The upscaled image looks worse

Then do not use it. That is the documented policy, not a workaround: "more
detail" is not "more real", and generative restoration is very willing to give
an elderly face a uniform field of manufactured pores.

```bash
local-photo generate "..." --upscale off              # deliver the frame as-is
local-photo upscale hero.jpg --scale 1.5 --upscaler lanczos
```

Lanczos is the only upscaler that is on by default, because it cannot invent
artefacts — it cannot invent anything. Real-ESRGAN and SeedVR2 have to be asked
for by name. See [BENCHMARK.md](BENCHMARK.md) for what was measured here.

### `Upscaler … is selected but not installed`

```bash
local-photo install-upscaler seedvr2-3b
```

---

## Apple Silicon specifics

### M5 and LoRA *training*

Draw Things has open issues (#114, #118) reporting that LoRA **training** for
the Z-Image and FLUX.2 families crashes at step 0 on Apple Silicon, and that
MFA can cause a scale overflow on M5. This project does not train anything —
it only runs inference — so those issues do not affect it. They are recorded
here so the failure is recognisable if you go looking for training support.

### Memory pressure during generation

```bash
local-photo benchmark --suite quick
```

reports peak memory and swap measured *during* generation rather than before
and after. If swap climbs, move to a more compressed variant:

```bash
local-photo benchmark --suite variants --apply q6p
```

---

## Integrations

### Pi does not show the tools

See [PI.md](PI.md) — usually the shim points at a `dist/` that has moved or has
not been built. `./scripts/install.sh` rewrites it.

### The MCP client sees no tools

Test the server directly with the JSON-RPC snippet in [MCP.md](MCP.md). If that
works and the client still shows nothing, the client's config has the wrong
absolute path — the server is spawned by path, not resolved from `PATH`.

### `render-html` says Playwright is missing

```bash
npm install --no-save playwright@1.62.1 && npx playwright install chromium
```

Optional by design: photo generation never needs a browser.

---

## Disk

Benchmarking model variants leaves every variant on disk. Reclaim the ones the
selected configuration does not use:

```bash
local-photo prune          # show what would go, and how much
local-photo prune --yes    # actually delete
```

It never touches the active variant or its companions, and it warns you that
re-downloading takes hours — because it does.

To check that what is on disk is what the manifest says it should be:

```bash
local-photo verify         # active configuration
local-photo verify --all   # every catalogued variant
```

A `repacked` line is normal, not a warning: Draw Things stores large models as
a small `.ckpt` header plus a `-tensordata` sidecar, so the upstream checksum
cannot apply. The combined byte count is checked instead.

## Starting over

```bash
./scripts/uninstall.sh          # integrations only, weights kept
./scripts/install.sh            # idempotent, safe to re-run
```

To reset only the machine-learned settings and keep the weights:

```bash
rm ~/Library/Application\ Support/local-photo-ai-m5/config.json
```
