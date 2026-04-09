#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
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

NOW_MS=$(date +%s%3N)
TS=$NOW_MS

# LIFESAVER: compute elapsed for this tool call using PreToolUse timestamp
SAFE_NAME=$(echo "$TOOL_NAME" | tr -c 'a-zA-Z0-9_-' '_')
TS_FILE="/tmp/hme_lifesaver_${SESSION_ID}_${SAFE_NAME}"
ELAPSED_S=0
if [ -f "$TS_FILE" ]; then
  START_MS=$(cat "$TS_FILE" 2>/dev/null)
  if [ -n "$START_MS" ] && [ "$START_MS" -gt 0 ] 2>/dev/null; then
    ELAPSED_MS=$((NOW_MS - START_MS))
    ELAPSED_S=$((ELAPSED_MS / 1000))
  fi
  rm -f "$TS_FILE" 2>/dev/null
fi

# LIFESAVER threshold: warn when MCP HME synthesis exceeds expected duration
if [[ "$TOOL_NAME" == mcp__HME__* ]] && [ "$ELAPSED_S" -gt 0 ]; then
  # warm_pre_edit_cache / review: 30s expected max (synthesis is now 60s HTTP timeout)
  # all other HME tools: 15s expected max
  THRESHOLD=15
  if [[ "$TOOL_NAME" == *warm_pre_edit_cache* ]] || [[ "$TOOL_NAME" == *review* ]]; then
    THRESHOLD=30
  fi
  if [ "$ELAPSED_S" -ge "$THRESHOLD" ]; then
    echo "LIFESAVER: ${TOOL_NAME} took ${ELAPSED_S}s (threshold: ${THRESHOLD}s)." >&2
    echo "  Slow MCP tools = stuck synthesis or model not loaded. Check:" >&2
    echo "  1. ollama ps — is qwen3:30b-a3b or qwen3-coder:30b actually running?" >&2
    echo "  2. HME log for _local_think TIMEOUT / REFUSED entries" >&2
    echo "  3. _local_think has 60s interactive timeout — if it exceeded that, something else blocked" >&2
  fi
fi

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
