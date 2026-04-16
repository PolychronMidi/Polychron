#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_onboarding.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_nexus.sh"
# HME PreToolUse: Edit — surface live KB constraints before editing project files.
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
NEW_STRING=$(_safe_jq "$INPUT" '.tool_input.new_string' '')
SESSION_ID=$(_safe_jq "$INPUT" '.session_id' 'unknown')
PROJECT="$PROJECT_ROOT"

# Activity bridge: emit edit_pending for src/ and tools/HME/ edits.
if echo "$FILE" | grep -qE '/(src|tools/HME/(mcp|chat|activity|hooks|scripts))/'; then
  _EDIT_MODULE=$(_extract_module "$FILE")
  _EDIT_READ_PRIOR=false
  if _nexus_has BRIEF "$_EDIT_MODULE" || _nexus_has BRIEF "$FILE"; then
    _EDIT_READ_PRIOR=true
  fi
  python3 "$PROJECT/tools/HME/activity/emit.py" \
    --event=edit_pending \
    --session="$SESSION_ID" \
    --file="$FILE" \
    --module="$_EDIT_MODULE" \
    --hme_read_prior="$_EDIT_READ_PRIOR" >/dev/null 2>&1 &
fi

if echo "$NEW_STRING" | grep -qiE '(#|//|/\*)[[:space:]]*(\.\.\.)?[[:space:]]*(existing|rest of|previous)[[:space:]]+(code|file|implementation|content|functions?)[[:space:]]*(\.\.\.)?'; then
  _emit_block "BLOCKED: Edit new_string contains comment-ellipsis stub placeholder. Use the ACTUAL replacement content — no stubs."
  exit 2
fi

# Warn if the edit is off-target during onboarding (per user spec: warn, not block)
if echo "$FILE" | grep -qE '/Polychron/src/' && ! _onb_is_graduated; then
  MODULE=$(_extract_module "$FILE")
  TARGET=$(_onb_target)
  if [ -n "$TARGET" ] && [ "$MODULE" != "$TARGET" ]; then
    echo "NEXUS: Editing $MODULE but onboarding target is $TARGET. Proceeding (warning, not a block)." >&2
  fi
fi

# Nexus: check if file was briefed with read(mode='before') — legacy soft warn
# (_nexus.sh is already sourced at top of file)
if echo "$FILE" | grep -qE '/Polychron/src/'; then
  MODULE=$(_extract_module "$FILE")
  if ! _nexus_has BRIEF "$MODULE" && ! _nexus_has BRIEF "$FILE" && _onb_is_graduated; then
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
