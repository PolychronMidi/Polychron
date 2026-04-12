#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: Read — anti-polling + live KB enrichment for project files.
# Uses updatedInput/systemMessage to inject KB context alongside the raw Read.
INPUT=$(cat)
FILE_PATH=$(_safe_jq "$INPUT" '.tool_input.file_path' '')

# Warn on background task output reads — the task notification system is the real
# guard against polling. Blocking here causes false positives on post-completion reads.
if echo "$FILE_PATH" | grep -qE '/tasks/[a-z0-9]+\.output$'; then
  echo "Task output file — if the task is still running, wait for the completion notification instead of polling." >&2
fi

# Project source files: enrich Read with live KB context via systemMessage.
# Read proceeds normally (agent gets file content) AND gets KB entries injected.
if echo "$FILE_PATH" | grep -qE '/Polychron/(src|tools/HME/(chat/src|mcp/server))/'; then
  MODULE=$(basename "$FILE_PATH" | sed 's/\.[jt]sx\?$//')
  KB_JSON=$(_hme_enrich "$MODULE")
  KB_COUNT=$(_hme_kb_count "$KB_JSON")
  if [[ "$KB_COUNT" -gt 0 ]]; then
    TITLES=$(_hme_kb_titles "$KB_JSON" 5)
    jq -n --arg module "$MODULE" --arg count "$KB_COUNT" --arg titles "$TITLES" \
      '{"hookSpecificOutput":{"permissionDecision":"allow"},"systemMessage":("KB context for " + $module + " (" + $count + " entries). For full briefing with callers + risks: mcp__HME__read(target=\"" + $module + "\", mode=\"before\")\n" + $titles)}'
    _streak_tick 5
    exit 0
  fi
fi
_streak_tick 5
if ! _streak_check; then exit 1; fi
exit 0
