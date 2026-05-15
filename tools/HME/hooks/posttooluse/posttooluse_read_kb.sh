#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
# PostToolUse: Read -- silent KB brief injection for src/ and tools/HME/ files.

INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
[ -z "$FILE" ] && exit 0

# Only enrich tracked source paths -- same predicate as nexus_tracking.js
if ! echo "$FILE" | grep -qE '/(src|tools/HME/(mcp|chat|activity|hooks|scripts|proxy))/'; then
  exit 0
fi

MODULE=$(basename "$FILE" | sed 's/\.[^.]*$//')
[ -z "$MODULE" ] && exit 0

# Mark BRIEF synchronously so pretooluse_edit.sh sees it this turn.
_brief_add "$MODULE" "posttooluse_read_kb"

# Fire KB brief async -- inject context into next response without blocking.
WORKER="$_HME_HTTP_PORT"
_PTRK_PY_ERR=$(mktemp 2>/dev/null || echo "/tmp/_ptrk_py_err_$$")  # silent-ok: optional fallback path.
_ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$MODULE" 2>"$_PTRK_PY_ERR" || echo "$MODULE")
if [ -s "$_PTRK_PY_ERR" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
  _PTRK_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
  while IFS= read -r _ptrk_line; do
    [ -n "$_ptrk_line" ] && echo "[$_PTRK_TS] [posttooluse_read_kb:url-encode] python3 failed: $_ptrk_line" \
      >> "$PROJECT_ROOT/log/hme-errors.log"
  done < "$_PTRK_PY_ERR"
fi
rm -f "$_PTRK_PY_ERR" 2>/dev/null
curl -sf --max-time 8 \
  "http://127.0.0.1:${WORKER}/hme/read?target=${_ENCODED}&mode=auto" \
  > /dev/null 2>&1 &

exit 0
