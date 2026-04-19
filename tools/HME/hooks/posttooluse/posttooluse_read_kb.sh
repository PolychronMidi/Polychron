#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
# PostToolUse: Read — silent KB brief injection for src/ and tools/HME/ files.
# Fires the same KB lookup as i/hme-read without requiring an explicit call.
# Only runs for tracked paths; exits 0 silently for everything else.

INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
[ -z "$FILE" ] && exit 0

# Only enrich tracked source paths — same predicate as nexus_tracking.js
if ! echo "$FILE" | grep -qE '/(src|tools/HME/(mcp|chat|activity|hooks|scripts|proxy))/'; then
  exit 0
fi

MODULE=$(basename "$FILE" | sed 's/\.[^.]*$//')
[ -z "$MODULE" ] && exit 0

# Mark BRIEF synchronously so pretooluse_edit.sh sees it this turn.
# _brief_add (vs raw _nexus_add) also emits a brief_recorded activity event
# so downstream can see which emission path fired.
_brief_add "$MODULE" "posttooluse_read_kb"

# Fire KB brief async — inject context into next response without blocking.
WORKER="${HME_SHIM_PORT:-9098}"
curl -sf --max-time 8 \
  "http://127.0.0.1:${WORKER}/hme/read?target=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$MODULE" 2>/dev/null || echo "$MODULE")&mode=auto" \
  > /dev/null 2>&1 &

exit 0
