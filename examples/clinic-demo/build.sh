#!/usr/bin/env bash
#
# End-to-end demonstration of the whole workflow:
#
#   image_generate → local asset → HTML/CSS → render → 1080x1350 post
#
# Fictional clinic. No real company data or branding.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
ASSETS="$HERE/assets"
OUT="$HERE/out"

# Prefer the linked command; fall back to the build in this checkout.
if command -v local-photo >/dev/null; then
  PHOTO=(local-photo)
else
  PHOTO=(node "$REPO_ROOT/dist/cli/index.js")
fi

mkdir -p "$ASSETS" "$OUT"

echo "==> 1/4  hero photograph (landscape, clinical)"
"${PHOTO[@]}" generate \
  --preset clinical \
  --prompt "médica brasileira conversando com paciente idosa em uma clínica moderna, ambas concentradas na conversa e não olhando para a câmera" \
  --size landscape \
  --seed 4821 \
  --output "$ASSETS/hero.jpg"

echo "==> 2/4  post photograph (portrait, same scene, different framing)"
"${PHOTO[@]}" generate \
  --preset clinical \
  --prompt "médica brasileira conversando com paciente idosa em uma clínica moderna, ambas concentradas na conversa e não olhando para a câmera" \
  --size post-portrait \
  --seed 9134 \
  --output "$ASSETS/post.jpg"

echo "==> 3/4  render the hero section"
"${PHOTO[@]}" render-html "$HERE/index.html" \
  --selector "#hero" \
  --width 1440 --height 900 \
  -o "$OUT/hero-section.png"

echo "==> 4/4  render the 1080x1350 social post"
"${PHOTO[@]}" render-html "$HERE/index.html" \
  --selector "#post" \
  --width 1080 --height 1350 \
  --scale 1 \
  -o "$OUT/post-1080x1350.png"

echo
echo "Done."
echo "  assets : $ASSETS"
echo "  renders: $OUT"
