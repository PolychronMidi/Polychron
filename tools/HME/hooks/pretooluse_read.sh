#!/usr/bin/env bash
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
  # Pull live KB hits from shim (2s timeout — graceful if shim is down)
  KB_JSON=$(curl -s --max-time 2 -X POST http://127.0.0.1:7734/enrich \
    -H 'Content-Type: application/json' \
    -d "{\"query\":\"$MODULE\",\"top_k\":3}" 2>/dev/null)
  KB_COUNT=$(echo "$KB_JSON" | jq -r '.kbCount // 0' 2>/dev/null)
  if [[ "$KB_COUNT" -gt 0 ]]; then
    KB_TITLES=$(echo "$KB_JSON" | jq -r '.kb[]?.title // empty' 2>/dev/null | head -3 | sed 's/^/    /')
    echo "HME KNOWS $MODULE ($KB_COUNT KB entries). Use mcp__HME__read(target=\"$MODULE\") for full briefing:" >&2
    echo "$KB_TITLES" >&2
  else
    echo "HME FIRST: Use mcp__HME__read(target=\"$MODULE\") for KB + callers + structure." >&2
  fi
fi
exit 0
