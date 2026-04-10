#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_nexus.sh"
# PostToolUse: Edit — track edited files, remind about review when backlog grows.
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Only track src/ and tools/HME/ edits (not docs, configs, etc.)
if echo "$FILE" | grep -qE '/(src|tools/HME/(mcp|chat))/'; then
  _nexus_add EDIT "$FILE"
  EDIT_COUNT=$(_nexus_count EDIT)
  if [ "$EDIT_COUNT" -ge 5 ]; then
    echo "NEXUS: ${EDIT_COUNT} files edited since last review. Run review(mode='forget') now — backlog is growing." >&2
  elif [ "$EDIT_COUNT" -ge 3 ]; then
    echo "NEXUS: ${EDIT_COUNT} files edited since last review. Consider review(mode='forget') soon." >&2
  fi
fi

# Reset streak counter — Edit PostToolUse means an HME-adjacent action happened
# (the PreToolUse already incremented; this doesn't interfere)
exit 0
