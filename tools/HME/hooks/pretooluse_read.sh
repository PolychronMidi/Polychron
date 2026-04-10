#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: Read — anti-polling + live KB surface for project files.
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Warn on background task output reads — the task notification system is the real
# guard against polling. Blocking here causes false positives on post-completion reads.
if echo "$FILE_PATH" | grep -qE '/tasks/[a-z0-9]+\.output$'; then
  echo "Task output file — if the task is still running, wait for the completion notification instead of polling." >&2
fi

# Project source files: surface live KB data from the shim
if echo "$FILE_PATH" | grep -qE '/Polychron/(src|tools/HME/(chat/src|mcp/server))/'; then
  MODULE=$(basename "$FILE_PATH" | sed 's/\.[jt]sx\?$//')
  KB_JSON=$(_hme_enrich "$MODULE")
  KB_COUNT=$(_hme_kb_count "$KB_JSON")
  if [[ "$KB_COUNT" -gt 0 ]]; then
    echo "HME KNOWS $MODULE ($KB_COUNT KB entries). Use mcp__HME__read(target=\"$MODULE\") for full briefing:" >&2
    _hme_kb_titles "$KB_JSON" >&2
  else
    echo "HME FIRST: Use mcp__HME__read(target=\"$MODULE\") for KB + callers + structure." >&2
  fi
fi
_streak_tick 5
if ! _streak_check; then exit 1; fi
exit 0
