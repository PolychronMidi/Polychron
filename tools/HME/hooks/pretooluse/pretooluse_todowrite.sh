#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME PreToolUse: TodoWrite — merge native payload with HME store (lifesaver,
# onboarding, hme_todo items) and emit the merged list as updatedInput so the
# agent's session-visible todo list includes all HME-managed items.
#
# This realizes the "silent replacement" vision: from the agent's perspective
# TodoWrite behaves exactly like native TodoWrite except that criticals,
# onboarding walkthroughs, and hme_todo subs also appear in the list.
#
# The merge logic lives in _todo_merge.py — a standalone Python script that
# bypasses server/tools_analysis/__init__.py (which requires a live FastMCP).
INPUT=$(cat)
PROJECT="$PROJECT_ROOT"
HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HME_LOG="${PROJECT}/log/hme.log"

MERGED_JSON=$(echo "$INPUT" | PROJECT_ROOT="$PROJECT" python3 "$HOOKS_DIR/_todo_merge.py" 2>>"$HME_LOG")

# Fallback: if merge returned empty, pass through incoming unchanged
if [ -z "$MERGED_JSON" ] || [ "$MERGED_JSON" = "[]" ]; then
  ORIG_TODOS=$(_safe_jq "$INPUT" '.tool_input.todos' '[]')
  MERGED_JSON="$ORIG_TODOS"
fi

printf '%s INFO hook: TodoWrite merged with HME store\n' \
  "$(date '+%Y-%m-%d %H:%M:%S,000')" >> "$HME_LOG" 2>/dev/null

# Emit updatedInput so the native TodoWrite runs with the merged list
jq -n --argjson todos "$MERGED_JSON" \
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"todos":$todos}}}'

exit 0
