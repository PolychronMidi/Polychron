#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_nexus.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_onboarding.sh"
# PostToolUse: Edit — track edited files, remind about review when backlog grows.
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')

# Only track src/ and tools/HME/ edits (not docs, configs, etc.)
if echo "$FILE" | grep -qE '/(src|tools/HME/(mcp|chat))/'; then
  _nexus_add EDIT "$FILE"
  EDIT_COUNT=$(_nexus_count EDIT)
  if [ "$EDIT_COUNT" -ge 5 ]; then
    echo "NEXUS: ${EDIT_COUNT} files edited since last review. Run review(mode='forget') now — backlog is growing." >&2
  elif [ "$EDIT_COUNT" -ge 3 ]; then
    echo "NEXUS: ${EDIT_COUNT} files edited since last review. Consider review(mode='forget') soon." >&2
  fi

  # Onboarding: advance briefed -> edited on first successful src/ edit
  if ! _onb_is_graduated && [ "$(_onb_state)" = "briefed" ]; then
    _onb_advance_to edited
    echo "NEXUS: onboarding advanced to 'edited'. Next: run review(mode='forget') to audit changes." >&2
  fi
fi

# Reset streak counter — Edit PostToolUse means an HME-adjacent action happened
# (the PreToolUse already incremented; this doesn't interfere)
exit 0
