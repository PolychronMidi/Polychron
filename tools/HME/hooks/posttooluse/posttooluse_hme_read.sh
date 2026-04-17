#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
# PostToolUse: mcp__HME__read — track briefed files for pre-edit verification.
INPUT=$(cat)
TARGET=$(_safe_jq "$INPUT" '.tool_input.target' '')
MODE=$(_safe_jq "$INPUT" '.tool_input.mode' 'auto')

# BRIEF is written BOTH here (synchronous with Claude Code's hook chain) and
# by proxy middleware (one request later). The double-write is idempotent and
# the shell write is load-bearing: posttooluse_edit.sh checks BRIEF in the
# same turn, and middleware's write won't land until the NEXT request.
if [ -n "$TARGET" ]; then
  _nexus_add BRIEF "$TARGET"
fi

_streak_reset

exit 0
