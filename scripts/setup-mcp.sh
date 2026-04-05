#!/usr/bin/env bash
# Wire HyperMeta Ecstasy into ~/.claude/ — MCP server, skills, hook scripts.
# Run once after cloning: bash scripts/setup-mcp.sh

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HME_DIR="$REPO_ROOT/tools/HyperMeta-Ecstasy"
MCP_DIR="$HOME/.claude/mcp"
SKILLS_DIR="$HOME/.claude/skills"

mkdir -p "$MCP_DIR" "$SKILLS_DIR"

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

_link "$HME_DIR/mcp" "$MCP_DIR/HyperMeta-Ecstasy" "mcp"
_link "$HME_DIR/skills" "$SKILLS_DIR/HyperMeta-Ecstasy" "skills"

# make hook scripts executable
chmod +x "$HME_DIR/hooks/"*.sh 2>/dev/null || true

# install venv if requirements.txt present
REQ="$HME_DIR/mcp/requirements.txt"
if [ -f "$REQ" ] && [ ! -d "$HME_DIR/mcp/venv" ]; then
  echo "installing venv..."
  python3 -m venv "$HME_DIR/mcp/venv"
  "$HME_DIR/mcp/venv/bin/pip" install -q -r "$REQ"
fi

echo "done. Hooks are in .claude/settings.json -> tools/HyperMeta-Ecstasy/hooks/"
