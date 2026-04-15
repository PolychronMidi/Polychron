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

TOOL_NAME=$(_safe_jq "$HOOK_DATA" '.tool_name' 'unknown')
TOOL_INPUT=$(echo "$HOOK_DATA" | jq -c '.tool_input // {}' 2>/dev/null | head -c 300)
TOOL_RESULT=$(_safe_jq "$HOOK_DATA" '.tool_response' '' | head -c 500)
FILE_PATH=$(_safe_jq "$HOOK_DATA" '.tool_input.file_path' '')
CWD=$(_safe_jq "$HOOK_DATA" '.cwd' '')
SESSION_ID=$(_safe_jq "$HOOK_DATA" '.session_id' '')

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

# Reset streak counter when HME tool is used
if [[ "$TOOL_NAME" == mcp__HME__* ]]; then
  _streak_reset

  # LIFESAVER: scan ALL HME tool output for FAIL/FAILED — log to hme-errors.log for stop.sh pickup.
  # Case-SENSITIVE match: test harnesses and pipeline runs emit uppercase
  # FAIL / FAILED markers (pytest, unittest, our invariant battery, KB
  # health, selftest). Prose "failed" (lowercase) commonly appears in
  # monitoring status banners — "connection failed (TimeoutError)" — and
  # must NOT be matched, or every HME tool call that quotes the banner
  # produces a false-positive error log entry.
  # Exclude lines containing PASS (test passed), "fail-fast" (project term),
  # or prose modal constructions ("fail to", "may fail", "might fail",
  # "could fail") from Edit Risks narrative text.
  FAILS=$(echo "$TOOL_RESULT" | grep -E '\bFAIL(ED)?\b' | grep -v 'PASS' | grep -vi 'fail-fast\|fail to\|may fail\|might fail\|could fail' 2>/dev/null || true)
  if [[ -n "$FAILS" ]]; then
    PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
    ERROR_LOG="$PROJECT/log/hme-errors.log"
    mkdir -p "$(dirname "$ERROR_LOG")"
    FAIL_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    while IFS= read -r line; do
      echo "[$FAIL_TS] $TOOL_NAME: $line" >> "$ERROR_LOG"
    done <<< "$FAILS"
    echo "🚨 LIFESAVER: FAIL in ${TOOL_NAME} output logged to hme-errors.log — stop.sh will block until fixed." >&2
  fi
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
    echo "  1. llamacpp ps — is qwen3:30b-a3b or qwen3-coder:30b actually running?" >&2
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

# 1. Append to JSONL + hme.log
PROJECT_ROOT="${CWD:-${PROJECT_ROOT:-$(pwd)}}"
LOG_FILE="$PROJECT_ROOT/log/session-transcript.jsonl"
HME_LOG="$PROJECT_ROOT/log/hme.log"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null
echo "$ENTRY" >> "$LOG_FILE" 2>/dev/null
TOOL_LOG_LINE=$(echo "$TOOL_INPUT" | head -c 120 | tr '\n' ' ')
printf '%s INFO tool: %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S,000')" "$TOOL_NAME" "$TOOL_LOG_LINE" >> "$HME_LOG" 2>/dev/null

# 2. POST to HTTP shim (background, non-blocking)
(_safe_curl "http://127.0.0.1:7734/transcript" "{\"entries\":[$ENTRY]}") &

# 3. If tool modified a file, trigger mini-reindex
if [ -n "$FILE_PATH" ]; then
  case "$TOOL_NAME" in
    Edit|Write)
      (_safe_curl "http://127.0.0.1:7734/reindex" "{\"files\":[\"$FILE_PATH\"]}") &
      ;;
  esac
fi

# Allow the tool call (no blocking decision)
exit 0
