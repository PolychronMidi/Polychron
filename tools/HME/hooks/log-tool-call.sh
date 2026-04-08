#!/usr/bin/env bash
# PostToolUse hook — logs every tool call from the main Claude Code session
# to the HME session transcript JSONL and the HTTP shim.
#
# Input (stdin): JSON from Claude Code hook system:
#   { tool_name, tool_input, tool_response, session_id, cwd, ... }
#
# This hook:
#   1. Appends a JSONL entry to log/session-transcript.jsonl
#   2. POSTs to the HTTP shim at localhost:7734/transcript (async, non-blocking)
#   3. If file was modified (Edit/Write), triggers mini-reindex via /reindex

# Read hook JSON from stdin
HOOK_DATA=$(cat)

TOOL_NAME=$(echo "$HOOK_DATA" | jq -r '.tool_name // "unknown"' 2>/dev/null)
TOOL_INPUT=$(echo "$HOOK_DATA" | jq -c '.tool_input // {}' 2>/dev/null | head -c 300)
TOOL_RESULT=$(echo "$HOOK_DATA" | jq -r '.tool_response // ""' 2>/dev/null | head -c 500)
FILE_PATH=$(echo "$HOOK_DATA" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
CWD=$(echo "$HOOK_DATA" | jq -r '.cwd // ""' 2>/dev/null)
SESSION_ID=$(echo "$HOOK_DATA" | jq -r '.session_id // ""' 2>/dev/null)

TS=$(($(date +%s) * 1000))

# Build transcript entry
ENTRY=$(jq -nc \
  --argjson ts "$TS" \
  --arg type "tool_call" \
  --arg route "main-session" \
  --arg session_id "$SESSION_ID" \
  --arg content "$TOOL_NAME: $TOOL_INPUT" \
  --arg result "$TOOL_RESULT" \
  --arg summary "Tool: $TOOL_NAME" \
  '{ts: $ts, type: $type, route: $route, session_id: $session_id, content: $content, result: $result, summary: $summary}' 2>/dev/null)

[ -z "$ENTRY" ] && exit 0

# 1. Append to JSONL
PROJECT_ROOT="${CWD:-${PROJECT_ROOT:-$(pwd)}}"
LOG_FILE="$PROJECT_ROOT/log/session-transcript.jsonl"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null
echo "$ENTRY" >> "$LOG_FILE" 2>/dev/null

# 2. POST to HTTP shim (background, non-blocking)
(curl -s -X POST "http://127.0.0.1:7734/transcript" \
  -H "Content-Type: application/json" \
  -d "{\"entries\":[$ENTRY]}" \
  --connect-timeout 1 --max-time 2 2>/dev/null || true) &

# 3. If tool modified a file, trigger mini-reindex
if [ -n "$FILE_PATH" ]; then
  case "$TOOL_NAME" in
    Edit|Write)
      (curl -s -X POST "http://127.0.0.1:7734/reindex" \
        -H "Content-Type: application/json" \
        -d "{\"files\":[\"$FILE_PATH\"]}" \
        --connect-timeout 1 --max-time 3 2>/dev/null || true) &
      ;;
  esac
fi

# Allow the tool call (no blocking decision)
exit 0
