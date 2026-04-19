#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# PreToolUse: Glob — block globs targeting compiled output (black box)
INPUT=$(cat)
PATTERN=$(_safe_jq "$INPUT" '.tool_input.pattern' '')
SEARCH_PATH=$(_safe_jq "$INPUT" '.tool_input.path' '')

# Block globs inside compiled output directory
if echo "$PATTERN$SEARCH_PATH" | grep -q "tools/HME/chat/out"; then
  _emit_block "BLOCKED: tools/HME/chat/out/ is a black box. Glob the .ts source in tools/HME/chat/src/ instead."
  exit 2
fi

_streak_tick 10
if ! _streak_check; then exit 1; fi
exit 0
