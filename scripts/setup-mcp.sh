#!/usr/bin/env bash
# Symlink repo-tracked MCP servers into ~/.claude/mcp/ so Claude Code finds them.
# Run once after cloning: bash scripts/setup-mcp.sh

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MCP_DIR="$HOME/.claude/mcp"

mkdir -p "$MCP_DIR"

for server_dir in "$REPO_ROOT"/tools/*/; do
  name="$(basename "$server_dir")"
  target="$MCP_DIR/$name"
  if [ -L "$target" ]; then
    echo "symlink exists: $target -> $(readlink "$target")"
  elif [ -e "$target" ]; then
    echo "WARNING: $target exists but is not a symlink -- skipping (move it manually)"
  else
    ln -s "$server_dir" "$target"
    echo "created: $target -> $server_dir"
  fi

  # install venv if requirements.txt present
  if [ -f "$server_dir/requirements.txt" ] && [ ! -d "$server_dir/venv" ]; then
    echo "installing venv for $name..."
    python3 -m venv "$server_dir/venv"
    "$server_dir/venv/bin/pip" install -q -r "$server_dir/requirements.txt"
  fi
done

echo "done."
