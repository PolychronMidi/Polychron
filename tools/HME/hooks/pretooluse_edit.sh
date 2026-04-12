#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: Edit — surface live KB constraints before editing project files.
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
NEW_STRING=$(_safe_jq "$INPUT" '.tool_input.new_string' '')
if echo "$NEW_STRING" | grep -qiE '(#|//|/\*)[[:space:]]*(\.\.\.)?[[:space:]]*(existing|rest of|previous)[[:space:]]+(code|file|implementation|content|functions?)[[:space:]]*(\.\.\.)?'; then
  echo '{"decision":"block","reason":"BLOCKED: Edit contains LLM stub placeholder (e.g. \"# ... existing code ...\"). Use the ACTUAL replacement content — no stubs."}' >&2
  exit 2
fi

# Nexus: check if file was briefed with read(mode='before')
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_nexus.sh"
if echo "$FILE" | grep -qE '/Polychron/src/'; then
  MODULE=$(basename "$FILE" | sed 's/\.[jt]sx\?$//')
  if ! _nexus_has BRIEF "$MODULE" && ! _nexus_has BRIEF "$FILE"; then
    echo "NEXUS: Editing $MODULE without pre-edit briefing. Call read(\"$MODULE\", mode=\"before\") first for KB constraints + callers + risks." >&2
  fi
fi

if echo "$FILE" | grep -qE '/Polychron/(src|tools/HME/(chat/src|mcp/server)|scripts)/'; then
  MODULE=$(basename "$FILE" | sed 's/\.[jt]sx\?$//')
  VAL_JSON=$(_hme_validate "$MODULE")
  BLOCKS=$(_safe_int "$(_safe_jq "$VAL_JSON" '.blocks | length' '0')")
  WARNS=$(_safe_int "$(_safe_jq "$VAL_JSON" '.warnings | length' '0')")
  if [[ "$BLOCKS" -gt 0 ]]; then
    BLOCK_TITLES=$(_safe_jq "$VAL_JSON" '.blocks[]?.title // empty' '' | head -2 | sed 's/^/    /')
    MSG="KB CONSTRAINTS for $MODULE ($BLOCKS blocks, $WARNS warnings):\n$BLOCK_TITLES\nCall mcp__HME__read(target=\"$MODULE\", mode=\"before\") for full pre-edit briefing."
    jq -n --arg msg "$MSG" \
      '{"hookSpecificOutput":{"permissionDecision":"allow"},"systemMessage":$msg}'
    _streak_tick 10
    exit 0
  elif [[ "$WARNS" -gt 0 ]]; then
    WARN_TITLES=$(_safe_jq "$VAL_JSON" '.warnings[]?.title // empty' '' | head -2 | sed 's/^/    /')
    MSG="KB CONTEXT for $MODULE ($WARNS entries):\n$WARN_TITLES\nCall mcp__HME__read(target=\"$MODULE\", mode=\"before\") for full pre-edit briefing."
    jq -n --arg msg "$MSG" \
      '{"hookSpecificOutput":{"permissionDecision":"allow"},"systemMessage":$msg}'
    _streak_tick 10
    exit 0
  else
    jq -n --arg module "$MODULE" \
      '{"hookSpecificOutput":{"permissionDecision":"allow"},"systemMessage":("BEFORE EDITING " + $module + ": Call mcp__HME__read(target=\"" + $module + "\", mode=\"before\") for KB constraints + callers + edit risks.")}'
    _streak_tick 10
    exit 0
  fi
fi
_streak_tick 10
if ! _streak_check; then exit 1; fi
exit 0
