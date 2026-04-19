#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# PostToolUse: TodoWrite — mirror high-priority native todos into HME store as
# critical=true so they surface in the userpromptsubmit LIFESAVER banner.
# Advisory only — exits 0 always, never blocks the tool call.
INPUT=$(cat)

PORT="${HME_MCP_PORT:-9098}"
HEALTH_URL="http://127.0.0.1:${PORT}/health"
SYNC_URL="http://127.0.0.1:${PORT}/hme/todo"

# Fast reachability check — skip silently if worker is down.
curl -s --max-time 1 "$HEALTH_URL" >/dev/null 2>&1 || exit 0

# Extract todos array from tool_input.
TODOS=$(_safe_jq "$INPUT" '.tool_input.todos' '[]')
if [ -z "$TODOS" ] || [ "$TODOS" = "[]" ] || [ "$TODOS" = "null" ]; then
  exit 0
fi

# Filter to high-priority, non-completed items for the critical mirror.
HIGH_TODOS=$(echo "$TODOS" | jq -c '[.[] | select(.priority=="high" and .status!="completed")]' 2>/dev/null)
if [ -z "$HIGH_TODOS" ] || [ "$HIGH_TODOS" = "[]" ]; then
  exit 0
fi

# POST the filtered list to the worker sync endpoint.
_safe_curl "$SYNC_URL" "{\"action\":\"sync_native\",\"todos\":${HIGH_TODOS}}" >/dev/null

exit 0
