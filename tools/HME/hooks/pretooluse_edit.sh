#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: Edit — surface live KB constraints before editing project files.
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
NEW_STRING=$(_safe_jq "$INPUT" '.tool_input.new_string' '')
if echo "$NEW_STRING" | grep -qiE '(#|//|/\*)[[:space:]]*(\.\.\.)?[[:space:]]*(existing|rest of|previous)[[:space:]]+(code|file|implementation|content|functions?)[[:space:]]*(\.\.\.)?'; then
  _emit_block "BLOCKED: Edit new_string contains comment-ellipsis stub placeholder. Use the ACTUAL replacement content — no stubs."
  exit 2
fi

# Nexus: check if file was briefed with read(mode='before')
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_nexus.sh"
if echo "$FILE" | grep -qE '/Polychron/src/'; then
  MODULE=$(_extract_module "$FILE")
  if ! _nexus_has BRIEF "$MODULE" && ! _nexus_has BRIEF "$FILE"; then
    echo "NEXUS: Editing $MODULE without pre-edit briefing. Call read(\"$MODULE\", mode=\"before\") first for KB constraints + callers + risks." >&2
  fi
fi

if _is_project_edit_src "$FILE"; then
  MODULE=$(_extract_module "$FILE")
  VAL_JSON=$(_hme_validate "$MODULE")
  BLOCKS=$(_safe_int "$(_safe_jq "$VAL_JSON" '.blocks | length' '0')")
  WARNS=$(_safe_int "$(_safe_jq "$VAL_JSON" '.warnings | length' '0')")
  if [[ "$BLOCKS" -gt 0 ]]; then
    BLOCK_TITLES=$(_safe_jq "$VAL_JSON" '.blocks[]?.title // empty' '' | head -2 | sed 's/^/    /')
    _emit_enrich_allow "KB CONSTRAINTS for $MODULE ($BLOCKS blocks, $WARNS warnings):
$BLOCK_TITLES
Call mcp__HME__read(target=\"$MODULE\", mode=\"before\") for full pre-edit briefing."
    _streak_tick 10
    exit 0
  elif [[ "$WARNS" -gt 0 ]]; then
    WARN_TITLES=$(_safe_jq "$VAL_JSON" '.warnings[]?.title // empty' '' | head -2 | sed 's/^/    /')
    _emit_enrich_allow "KB CONTEXT for $MODULE ($WARNS entries):
$WARN_TITLES
Call mcp__HME__read(target=\"$MODULE\", mode=\"before\") for full pre-edit briefing."
    _streak_tick 10
    exit 0
  fi
fi
_streak_tick 10
if ! _streak_check; then exit 1; fi
exit 0
