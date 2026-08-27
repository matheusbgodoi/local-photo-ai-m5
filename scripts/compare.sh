#!/usr/bin/env bash
#
# Build a 100% detail strip from a set of images, for judging skin, hair,
# reflections and edges — the places realism actually lives, and the first
# things a downscaled contact sheet hides.
#
#   ./scripts/compare.sh out.jpg 320 380 420 420 a.png b.png c.png
#                        │       │   │   │   │   └── images
#                        │       │   │   └───┴────── crop width, height
#                        │       └───┴────────────── crop left, top
#                        └───────────────────────── output
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 6 ]]; then
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
fi

OUT="$1"; LEFT="$2"; TOP="$3"; W="$4"; H="$5"
shift 5

node --input-type=module -e "
import { detailStrip } from '$REPO_ROOT/dist/core/contactsheet.js';
const files = process.argv.slice(1);
const cells = files.map((f) => ({ file: f, label: f.split('/').pop().replace(/\.(png|jpg)$/, '') }));
const out = await detailStrip(cells, '$OUT', { left: $LEFT, top: $TOP, width: $W, height: $H });
console.log(out);
" -- "$@"
