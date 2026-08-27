#!/usr/bin/env bash
#
# local-photo-ai-m5 — installer.
#
# Idempotent by construction: every step checks before it acts, large downloads
# are skipped when the artifact already exists, and nothing is hardcoded to a
# particular user or machine. Re-running it is the supported way to repair an
# installation.
#
#   ./scripts/install.sh              # minimal: engine + model + CLI + Pi + MCP
#   ./scripts/install.sh --full       # also: upscaler weights, Playwright
#   ./scripts/install.sh --no-model   # skip the multi-GB download
#   ./scripts/install.sh --help
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MODE="minimal"
INSTALL_MODEL=1
INSTALL_BREW=1
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --full) MODE="full" ;;
    --minimal) MODE="minimal" ;;
    --no-model) INSTALL_MODEL=0 ;;
    --skip-brew) INSTALL_BREW=0 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# --- output helpers ---------------------------------------------------------
if [[ -t 1 ]]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[90m'; N=$'\033[0m'
else
  B=""; G=""; Y=""; R=""; D=""; N=""
fi
step()  { printf '\n%s==>%s %s%s%s\n' "$B" "$N" "$B" "$*" "$N"; }
ok()    { printf '    %sok%s   %s\n' "$G" "$N" "$*"; }
warn()  { printf '    %swarn%s %s\n' "$Y" "$N" "$*"; }
die()   { printf '\n%serror%s %s\n' "$R" "$N" "$*" >&2; exit 1; }
info()  { printf '    %s%s%s\n' "$D" "$*" "$N"; }

# --- 1. platform ------------------------------------------------------------
step "Checking the platform"

[[ "$(uname -s)" == "Darwin" ]] || die "This project targets macOS on Apple Silicon; found $(uname -s)."
ARCH="$(uname -m)"
[[ "$ARCH" == "arm64" ]] || die "Apple Silicon required; found architecture '$ARCH'."

CHIP="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Apple Silicon")"
MEM_GB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
MACOS="$(sw_vers -productVersion)"
ok "$CHIP · ${MEM_GB} GB unified memory · macOS $MACOS"

if (( MEM_GB < 16 )); then
  warn "Under 16 GB of unified memory. Z-Image Turbo will run, but expect swapping."
fi

# --- 2. disk ----------------------------------------------------------------
step "Checking disk space"

MODELS_DIR="${LOCAL_PHOTO_MODELS_DIR:-$HOME/Library/Application Support/local-photo-ai-m5/models}"
mkdir -p "$MODELS_DIR"
FREE_GB=$(df -g "$MODELS_DIR" | awk 'NR==2 {print $4}')
NEEDED=12
[[ "$MODE" == "full" ]] && NEEDED=25
if (( FREE_GB < NEEDED )); then
  die "Need about ${NEEDED} GB free for a '$MODE' install; only ${FREE_GB} GB available at $MODELS_DIR"
fi
ok "${FREE_GB} GB free at $MODELS_DIR"

# --- 3. dependencies --------------------------------------------------------
step "Checking dependencies"

command -v node >/dev/null || die "Node.js is required. Install Node 22+ and re-run."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 22 )) || die "Node 22 or newer is required; found $(node --version)."
ok "node $(node --version)"
command -v npm >/dev/null || die "npm is required."
ok "npm $(npm --version)"
command -v git >/dev/null && ok "git $(git --version | awk '{print $3}')" || warn "git not found (only needed for development)"

if (( INSTALL_BREW )); then
  if ! command -v brew >/dev/null; then
    die "Homebrew is required to install Draw Things. Install from https://brew.sh, or pass --skip-brew and install Draw Things manually."
  fi
  ok "homebrew $(brew --version | head -1 | awk '{print $2}')"
fi

# --- 4. Draw Things.app -----------------------------------------------------
step "Draw Things.app (manual use)"

if [[ -d "/Applications/Draw Things.app" || -d "$HOME/Applications/Draw Things.app" ]]; then
  ok "already installed"
elif (( INSTALL_BREW )); then
  info "brew install --cask draw-things"
  brew install --cask draw-things
  ok "installed"
else
  warn "not installed and --skip-brew was passed; manual use of the GUI will not be available"
fi

# --- 5. draw-things-cli -----------------------------------------------------
step "draw-things-cli (automation)"

if command -v draw-things-cli >/dev/null; then
  ok "already installed ($(command -v draw-things-cli))"
elif (( INSTALL_BREW )); then
  info "brew install draw-things-cli"
  brew install draw-things-cli
  ok "installed"
else
  die "draw-things-cli not found and --skip-brew was passed. Install it with: brew install draw-things-cli"
fi

# --- 6. node dependencies ---------------------------------------------------
step "Node dependencies"

if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi
ok "installed"

# --- 7. build ---------------------------------------------------------------
step "Building"
npm run build
ok "dist/ built"

# --- 8. the local-photo command --------------------------------------------
step "Installing the local-photo command"

NPM_BIN="$(npm prefix -g)/bin"
if [[ -w "$NPM_BIN" ]]; then
  ln -sf "$REPO_ROOT/dist/cli/index.js" "$NPM_BIN/local-photo"
  chmod +x "$REPO_ROOT/dist/cli/index.js"
  ok "linked $NPM_BIN/local-photo"
else
  warn "$NPM_BIN is not writable; falling back to ~/.local/bin"
  mkdir -p "$HOME/.local/bin"
  ln -sf "$REPO_ROOT/dist/cli/index.js" "$HOME/.local/bin/local-photo"
  ok "linked $HOME/.local/bin/local-photo"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) warn "Add \$HOME/.local/bin to your PATH to use 'local-photo'." ;;
  esac
fi

# --- 9. the model -----------------------------------------------------------
step "Z-Image Turbo weights"

if (( INSTALL_MODEL )); then
  if node dist/cli/index.js health >/dev/null 2>&1; then
    ok "already installed"
  else
    info "downloading — this is several GB and only happens once"
    node dist/cli/index.js install-model
    ok "installed"
  fi
else
  warn "skipped (--no-model). Run 'local-photo install-model' before generating."
fi

# --- 10. optional components ------------------------------------------------
if [[ "$MODE" == "full" ]]; then
  step "Optional components (--full)"

  info "SeedVR2 3B upscaler"
  node dist/cli/index.js install-upscaler seedvr2-3b || warn "upscaler download failed; it stays disabled"

  info "Playwright + Chromium (for render-html)"
  # Version pinned in package.json under localPhoto.optionalTools so --full is
  # reproducible, but kept out of dependencies so a minimal install never
  # downloads a browser.
  PLAYWRIGHT_VERSION="$(node -p "require('./package.json').localPhoto.optionalTools.playwright" 2>/dev/null || echo latest)"
  if npm install --no-save --no-audit --no-fund "playwright@$PLAYWRIGHT_VERSION" >/dev/null 2>&1; then
    npx playwright install chromium || warn "chromium download failed"
    ok "playwright ready"
  else
    warn "playwright install failed; render-html will stay unavailable"
  fi

  # Realism adapters are installed but never enabled: the benchmark on this
  # hardware found the raw model plus a good brief more photographic. See
  # docs/BENCHMARK.md. They are here so you can re-run that comparison.
  info "Realism LoRA (installed, left disabled)"
  node dist/cli/index.js lora install realstagram-zimg \
    || warn "Realstagram download failed; the pipeline runs fine without it"

  if [[ -n "${CIVITAI_TOKEN:-}" ]] || grep -qs '^CIVITAI_TOKEN=.\+' .env; then
    node dist/cli/index.js lora install realistic-snapshot-zit-v5 \
      || warn "Realistic Snapshot download failed"
  else
    info "no CIVITAI_TOKEN — skipping Realistic Snapshot (see .env.example)"
  fi
  info "enable one with: local-photo lora enable <id> --strength 0.4"
fi

# --- 11. Pi extension -------------------------------------------------------
step "Pi extension"

PI_EXT_DIR="$HOME/.pi/agent/extensions/local-photo"
if [[ -d "$HOME/.pi/agent" ]]; then
  mkdir -p "$PI_EXT_DIR"
  cat > "$PI_EXT_DIR/index.ts" <<EOF
// Generated by local-photo-ai-m5 scripts/install.sh — do not edit.
// The implementation lives in the repository so it stays version-controlled.
export { default } from "$REPO_ROOT/dist/pi/index.js";
EOF
  ok "installed at $PI_EXT_DIR"
  info "tools: image_generate, image_upscale, image_health, image_prompt_preview"
else
  warn "Pi is not installed (~/.pi/agent not found); skipping"
fi

# --- 12. MCP ----------------------------------------------------------------
step "MCP server"

MCP_CMD="$REPO_ROOT/dist/mcp/server.js"
chmod +x "$MCP_CMD"
if command -v claude >/dev/null; then
  if claude mcp list 2>/dev/null | grep -q "^local-photo"; then
    ok "already registered with Claude Code"
  elif (( ASSUME_YES )) || [[ ! -t 0 ]]; then
    claude mcp add -s user local-photo -- node "$MCP_CMD" >/dev/null 2>&1 \
      && ok "registered with Claude Code" \
      || warn "could not register automatically"
  else
    printf '    register the MCP server with Claude Code? [Y/n] '
    read -r reply
    if [[ ! "$reply" =~ ^[Nn] ]]; then
      claude mcp add -s user local-photo -- node "$MCP_CMD" >/dev/null 2>&1 \
        && ok "registered" || warn "could not register automatically"
    fi
  fi
else
  info "Claude Code CLI not found. Register manually with any MCP client:"
fi
info "stdio command:  node $MCP_CMD"

# --- 13. doctor -------------------------------------------------------------
step "Diagnostics"
node dist/cli/index.js doctor || true

# --- 14. smoke test ---------------------------------------------------------
step "Smoke test"

if node dist/cli/index.js health >/dev/null 2>&1; then
  SMOKE_DIR="$(mktemp -d)"
  if node dist/cli/index.js generate \
        --prompt "uma xícara de café sobre uma mesa de escritório real" \
        --preset product --width 512 --height 512 --seed 7 \
        --output "$SMOKE_DIR/smoke.jpg" --quiet >/dev/null 2>&1; then
    ok "generated $(du -h "$SMOKE_DIR/smoke.jpg" | awk '{print $1}') test image"
    rm -rf "$SMOKE_DIR"
  else
    rm -rf "$SMOKE_DIR"
    die "Smoke test failed. Run 'local-photo doctor' for details."
  fi
else
  warn "skipped — the model is not installed yet"
fi

printf '\n%sReady.%s  Try:\n' "$B" "$N"
printf '  local-photo generate "médica conversando com paciente idosa" --preset clinical\n'
printf '  local-photo generate --help\n'
printf '  local-photo doctor\n\n'
