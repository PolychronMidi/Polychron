#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: Edit — surface live KB constraints before editing project files.
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
NEW_STRING=$(echo "$INPUT" | jq -r '.tool_input.new_string // ""')
if echo "$NEW_STRING" | grep -qiE '(#|//|/\*)[[:space:]]*(\.\.\.)?[[:space:]]*(existing|rest of|previous)[[:space:]]+(code|file|implementation|content|functions?)[[:space:]]*(\.\.\.)?'; then
  echo '{"decision":"block","reason":"BLOCKED: Edit contains LLM stub placeholder (e.g. \"# ... existing code ...\"). Use the ACTUAL replacement content — no stubs."}' >&2
  exit 2
fi

if echo "$FILE" | grep -qE '/Polychron/(src|tools/HME/(chat/src|mcp/server)|scripts)/'; then
  MODULE=$(basename "$FILE" | sed 's/\.[jt]sx\?$//')
  # Pull live constraint check from shim (2s timeout)
  VAL_JSON=$(_safe_curl "http://127.0.0.1:7734/validate" "{\"query\":\"$MODULE\"}")
  BLOCKS=$(_safe_int "$(_safe_jq "$VAL_JSON" '.blocks | length' '0')")
  WARNS=$(_safe_int "$(_safe_jq "$VAL_JSON" '.warnings | length' '0')")
  if [[ "$BLOCKS" -gt 0 ]]; then
    BLOCK_TITLES=$(_safe_jq "$VAL_JSON" '.blocks[]?.title // empty' '' | head -2 | sed 's/^/    ⛔ /')
    echo "KB CONSTRAINTS for $MODULE ($BLOCKS blocks, $WARNS warnings):" >&2
    echo "$BLOCK_TITLES" >&2
    echo "Call mcp__HME__read(target=\"$MODULE\", mode=\"before\") for full pre-edit briefing." >&2
  elif [[ "$WARNS" -gt 0 ]]; then
    WARN_TITLES=$(_safe_jq "$VAL_JSON" '.warnings[]?.title // empty' '' | head -2 | sed 's/^/    /')
    echo "KB CONTEXT for $MODULE ($WARNS entries):" >&2
    echo "$WARN_TITLES" >&2
    echo "Call mcp__HME__read(target=\"$MODULE\", mode=\"before\") for full pre-edit briefing." >&2
  else
    echo "BEFORE EDITING $MODULE: Call mcp__HME__read(target=\"$MODULE\", mode=\"before\") for KB constraints + callers + edit risks." >&2
  fi
fi
exit 0
