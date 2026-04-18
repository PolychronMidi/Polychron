#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
# PostToolUse: `npm run hme-read` dispatch (called by posttooluse_bash.sh).
# Parses target from tool_input.command: `target=...` or `--target ...`.
INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')
TARGET=$(echo "$CMD" | grep -oE '\btarget[= ][^[:space:]]+' | head -1 | sed -E 's/^.*target[= ]//')
MODE=$(echo "$CMD" | grep -oE '\bmode[= ][a-z_]+' | head -1 | sed -E 's/^.*mode[= ]//')
[ -z "$MODE" ] && MODE="auto"

# BRIEF is written BOTH here (synchronous with Claude Code's hook chain) and
# by proxy middleware (one request later). The double-write is idempotent and
# the shell write is load-bearing: posttooluse_edit.sh checks BRIEF in the
# same turn, and middleware's write won't land until the NEXT request.
if [ -n "$TARGET" ]; then
  _nexus_add BRIEF "$TARGET"
fi

_streak_reset

exit 0
