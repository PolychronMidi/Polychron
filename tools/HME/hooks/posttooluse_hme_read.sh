#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_nexus.sh"
# PostToolUse: mcp__HME__read — track briefed files for pre-edit verification.
INPUT=$(cat)
TARGET=$(_safe_jq "$INPUT" '.tool_input.target' '')
MODE=$(_safe_jq "$INPUT" '.tool_input.mode' 'auto')

# Track briefings (before mode or any read of a src file)
if [ -n "$TARGET" ]; then
  _nexus_add BRIEF "$TARGET"
fi

_streak_reset

exit 0
