#!/usr/bin/env bash
#
# local-photo-ai-m5 — uninstaller.
#
# Removes the integration points this project created: the CLI link, the Pi
# extension and the MCP registration. Model weights are NOT deleted without an
# explicit confirmation — they are many gigabytes and re-downloading them is
# slow.
#
#   ./scripts/uninstall.sh                 # integrations only
#   ./scripts/uninstall.sh --weights       # also offer to delete weights
#   ./scripts/uninstall.sh --all --yes     # everything, no prompts
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REMOVE_WEIGHTS=0
REMOVE_STATE=0
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --weights) REMOVE_WEIGHTS=1 ;;
    --state) REMOVE_STATE=1 ;;
    --all) REMOVE_WEIGHTS=1; REMOVE_STATE=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [[ -t 1 ]]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; N=$'\033[0m'
else
  B=""; G=""; Y=""; N=""
fi
step() { printf '\n%s==>%s %s\n' "$B" "$N" "$*"; }
ok()   { printf '    %sok%s   %s\n' "$G" "$N" "$*"; }
skip() { printf '    %s--%s   %s\n' "$Y" "$N" "$*"; }

confirm() {
  (( ASSUME_YES )) && return 0
  printf '    %s [y/N] ' "$1"
  read -r reply
  [[ "$reply" =~ ^[Yy] ]]
}

# --- CLI link ---------------------------------------------------------------
step "CLI command"
REMOVED=0
for dir in "$(npm prefix -g 2>/dev/null)/bin" "$HOME/.local/bin"; do
  link="$dir/local-photo"
  if [[ -L "$link" ]]; then
    rm -f "$link"
    ok "removed $link"
    REMOVED=1
  fi
done
(( REMOVED )) || skip "no local-photo link found"

# --- Pi extension -----------------------------------------------------------
step "Pi extension"
PI_EXT_DIR="$HOME/.pi/agent/extensions/local-photo"
if [[ -d "$PI_EXT_DIR" ]]; then
  rm -rf "$PI_EXT_DIR"
  ok "removed $PI_EXT_DIR"
else
  skip "not installed"
fi

# --- MCP registration -------------------------------------------------------
step "MCP registration"
if command -v claude >/dev/null && claude mcp list 2>/dev/null | grep -q "^local-photo"; then
  claude mcp remove local-photo >/dev/null 2>&1 && ok "removed from Claude Code" || skip "could not remove automatically"
else
  skip "not registered with Claude Code"
fi
printf '    %sIf you registered the MCP server with another client, remove it there too.%s\n' "$Y" "$N"

# --- state ------------------------------------------------------------------
STATE_DIR="${LOCAL_PHOTO_STATE_DIR:-$HOME/Library/Application Support/local-photo-ai-m5}"
MODELS_DIR="${LOCAL_PHOTO_MODELS_DIR:-$STATE_DIR/models}"

step "Configuration and logs"
if (( REMOVE_STATE )) && [[ -d "$STATE_DIR" ]]; then
  for sub in config.json logs downloads; do
    [[ -e "$STATE_DIR/$sub" ]] && rm -rf "${STATE_DIR:?}/$sub" && ok "removed $sub"
  done
else
  skip "kept $STATE_DIR (pass --state to remove)"
fi

# --- weights ----------------------------------------------------------------
step "Model weights"
if [[ -d "$MODELS_DIR" ]]; then
  SIZE="$(du -sh "$MODELS_DIR" 2>/dev/null | awk '{print $1}')"
  if (( REMOVE_WEIGHTS )); then
    printf '    %s%s of weights at %s%s\n' "$Y" "$SIZE" "$MODELS_DIR" "$N"
    if confirm "Delete them? This cannot be undone and re-downloading takes hours."; then
      rm -rf "${MODELS_DIR:?}"
      ok "deleted"
    else
      skip "kept"
    fi
  else
    skip "kept $SIZE at $MODELS_DIR (pass --weights to be asked about deleting)"
  fi
else
  skip "no weights directory"
fi

# --- what we deliberately do not touch --------------------------------------
step "Left alone on purpose"
printf '    Draw Things.app and draw-things-cli — remove with:\n'
printf '      brew uninstall --cask draw-things && brew uninstall draw-things-cli\n'
printf '    The repository itself: %s\n' "$REPO_ROOT"
printf '\nDone.\n\n'
