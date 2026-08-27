# Clinic demo

A fictional clinic — "Clínica Aurora" — used to exercise the complete workflow
end to end. There is no real company data, branding or asset here.

```
image_generate  →  local asset  →  HTML/CSS  →  render  →  1080×1350 post
```

## Run it

```bash
./examples/clinic-demo/build.sh
```

Four steps:

1. a **landscape** hero photograph, `--preset clinical`
2. a **4:5 portrait** of the same scene for social, different seed and framing
3. the hero section rendered at 1440×900
4. the post rendered at exactly **1080×1350**

Outputs:

| path | what |
| --- | --- |
| `assets/hero.jpg`, `assets/post.jpg` | the generated photographs — Lanczos 1.5× finals |
| `assets/hero.raw.jpg`, `assets/post.raw.jpg` | the models' own frames, kept unscaled |
| `assets/*.json` | reproducibility sidecars, referencing both |
| `out/hero-section.png` | the composed website hero |
| `out/post-1080x1350.png` | the finished social post |

`assets/` and `out/` are git-ignored — generated imagery never enters the
repository.

Step 3 and 4 need Playwright:

```bash
npm install --no-save playwright@1.62.1 && npx playwright install chromium
```

## What it is actually testing

- The photograph lands where an agent asked it to, by absolute path.
- The **same scene** at two aspect ratios still looks like the same clinic —
  which is what a real campaign needs and what a one-off generation cannot
  prove.
- Diffusion runs at a model-friendly size and the *delivery* dimensions come
  from resampling, so the 1080×1350 post has no stretched faces.
- A photograph composited under a CSS scrim still reads as a photograph. This
  is where over-processed generations fall apart: an image with baked-in HDR
  and crushed blacks has nothing left to give once a gradient sits on top of
  it.

## Reproducing a frame

```bash
local-photo reproduce examples/clinic-demo/assets/hero.json
```

The seeds in `build.sh` are fixed so the demo is repeatable. Change them to
explore alternatives, or drop `--seed` entirely and run with `--count 4`.
