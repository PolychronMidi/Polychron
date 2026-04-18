#!/usr/bin/env bash
# HyperMeta Ecstasy bootstrap — run once after cloning.
# Installs venv, makes hooks + wrappers executable, symlinks the skill
# directory into Claude Code's skill path.
#
# The MCP-server symlink (~/.claude/mcp/HME) was retired in the MCP
# decoupling — HME tools are now invoked via shell wrappers in `i/` that
# hit the worker's HTTP endpoint directly. See doc/HME.md for details.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HME_DIR="$REPO_ROOT/tools/HME"
SKILLS_DIR="$HOME/.claude/skills"

mkdir -p "$SKILLS_DIR"

# Skills symlink — still lives under ~/.claude/skills/ because that's where
# Claude Code looks for `/HME` skill resolution. Unaffected by MCP decoupling.
_link() {
  local target="$1" link="$2" label="$3"
  if [ -L "$link" ]; then
    echo "symlink exists: $link -> $(readlink "$link")"
  elif [ -e "$link" ]; then
    echo "WARNING: $link exists but is not a symlink -- skipping (move it manually)"
  else
    ln -s "$target" "$link"
    echo "created $label: $link -> $target"
  fi
}
_link "$HME_DIR/skills" "$SKILLS_DIR/HME" "skills"

# Make hook scripts + i/ wrappers executable.
chmod +x "$HME_DIR/hooks/"*.sh 2>/dev/null || true
chmod +x "$REPO_ROOT/i/"* 2>/dev/null || true

# Install venv if requirements.txt present.
REQ="$HME_DIR/mcp/requirements.txt"
if [ -f "$REQ" ] && [ ! -d "$HME_DIR/mcp/venv" ]; then
  echo "installing venv..."
  python3 -m venv "$HME_DIR/mcp/venv"
  "$HME_DIR/mcp/venv/bin/pip" install -q -r "$REQ"
fi

echo "done. Launch with: bash tools/HME/launcher/polychron-launch.sh"
