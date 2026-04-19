#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
# PostToolUse: `i/hme-read` dispatch (called by posttooluse_bash.sh).
# Parses target from tool_input.command: `target=...` or `--target ...`.
INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')

# Fail-fast on CLI transport errors — never mark BRIEF if the read never
# actually retrieved KB context. Otherwise pretooluse_edit.sh would see a
# spurious BRIEF and let the edit through unbriefed.
TOOL_RESULT=$(_safe_jq "$INPUT" '.tool_response' '')
if echo "$TOOL_RESULT" | grep -q '^hme-cli:'; then
  echo "NEXUS: hme-read CLI failed — BRIEF NOT marked. Investigate worker/shim health before editing this file." >&2
  exit 0
fi

TARGET=$(echo "$CMD" | grep -oE '\btarget[= ][^[:space:]]+' | head -1 | sed -E 's/^.*target[= ]//')
MODE=$(echo "$CMD" | grep -oE '\bmode[= ][a-z_]+' | head -1 | sed -E 's/^.*mode[= ]//')
[ -z "$MODE" ] && MODE="auto"

# BRIEF is written BOTH here (synchronous with Claude Code's hook chain) and
# by proxy middleware (one request later). The double-write is idempotent and
# the shell write is load-bearing: posttooluse_edit.sh checks BRIEF in the
# same turn, and middleware's write won't land until the NEXT request.
if [ -n "$TARGET" ]; then
  _brief_add "$TARGET" "posttooluse_hme_read"
fi

_streak_reset

exit 0
