#!/usr/bin/env bash
# _safety.sh lives under helpers/ after the hooks reorg. A missing
# source here silently kills every _safe_jq / _safe_curl downstream,
# which means LIFESAVER's FAIL-scan, elapsed-time threshold, and the
# newer hme.log ERROR watermark ALL go dark. Fail fast with exit 1
# instead if the helper can't be sourced.
set -e
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/helpers/_safety.sh"
set +e
# PostToolUse hook — logs every tool call from the main Claude Code session
# to the HME session transcript JSONL and the HTTP shim.
#
# Input (stdin): JSON from Claude Code hook system:
#   { tool_name, tool_input, tool_response, session_id, cwd, ... }
#
# This hook:
#   1. Appends a JSONL entry to log/session-transcript.jsonl
#   2. POSTs to the HTTP shim at localhost:9098/transcript (async, non-blocking)
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

# HME tools are now invoked via Bash(npm run <tool>) — the tool_name is "Bash"
# and the actual HME call lives in tool_input.command. Detect by grepping the
# command for `npm run <hme-tool>`. Also keep the legacy mcp__HME__ pattern
# so any remaining MCP-era integrations keep emitting streak resets.
_IS_HME_CALL=0
_HME_TOOL=""
if [[ "$TOOL_NAME" == mcp__HME__* ]]; then
  _IS_HME_CALL=1
  _HME_TOOL="${TOOL_NAME#mcp__HME__}"
elif [[ "$TOOL_NAME" == "Bash" ]]; then
  # Match: `npm run review`, `npm run learn --`, `node scripts/hme-cli.js trace`, etc.
  if echo "$TOOL_INPUT" | grep -qE 'npm run (review|learn|trace|evolve|hme-admin|status|todo|hme-read|hme)\b|scripts/hme-cli\.js'; then
    _IS_HME_CALL=1
    _HME_TOOL=$(echo "$TOOL_INPUT" | grep -oE 'npm run ([a-z_-]+)' | head -1 | awk '{print $3}')
  fi
fi

# LIFESAVER FAIL-scan + hme.log ERROR watermark moved to proxy middleware
# (mcp_fail_scan.js + hme_log_watermark.js). Shell hook keeps only streak reset.
if [ "$_IS_HME_CALL" = "1" ]; then
  _streak_reset
fi

# LIFESAVER threshold: warn when HME synthesis exceeds expected duration
if [ "$_IS_HME_CALL" = "1" ] && [ "$ELAPSED_S" -gt 0 ]; then
  # review / warm_pre_edit_cache: 30s expected max (synthesis is 60s HTTP timeout).
  # All other HME tools: 15s expected max.
  THRESHOLD=15
  if [[ "$_HME_TOOL" == *warm_pre_edit_cache* ]] || [[ "$_HME_TOOL" == *review* ]]; then
    THRESHOLD=30
  fi
  if [ "$ELAPSED_S" -ge "$THRESHOLD" ]; then
    echo "LIFESAVER: HME tool '${_HME_TOOL}' took ${ELAPSED_S}s (threshold: ${THRESHOLD}s)." >&2
    echo "  Slow HME tools = stuck synthesis or model not loaded. Check:" >&2
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
# PROJECT_ROOT comes from .env via _safety.sh. Never fall back to CWD/pwd — the
# hook's .cwd field is the TOOL's working directory (which can be anywhere in
# the tree), and using it as PROJECT_ROOT silently spawns duplicate log/
# directories (tools/HME/chat/log/, tools/HME/chat/webview/log/, etc.).
if [ -z "${PROJECT_ROOT:-}" ] || [ ! -d "$PROJECT_ROOT/src" ]; then
  echo "log-tool-call: PROJECT_ROOT unset or invalid ($PROJECT_ROOT) — skipping transcript write" >&2
  exit 0
fi
LOG_FILE="$PROJECT_ROOT/log/session-transcript.jsonl"
HME_LOG="$PROJECT_ROOT/log/hme.log"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null
echo "$ENTRY" >> "$LOG_FILE" 2>/dev/null
TOOL_LOG_LINE=$(echo "$TOOL_INPUT" | head -c 120 | tr '\n' ' ')
printf '%s INFO tool: %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S,000')" "$TOOL_NAME" "$TOOL_LOG_LINE" >> "$HME_LOG" 2>/dev/null

# 2. mcp_tool_call activity emission moved to proxy middleware (activity_log.js).

# 3. POST to HTTP shim (background, non-blocking)
(_safe_curl "http://127.0.0.1:9098/transcript" "{\"entries\":[$ENTRY]}") &

# 3. If tool modified a file, trigger mini-reindex
if [ -n "$FILE_PATH" ]; then
  case "$TOOL_NAME" in
    Edit|Write)
      (_safe_curl "http://127.0.0.1:9098/reindex" "{\"files\":[\"$FILE_PATH\"]}") &
      ;;
  esac
fi

# Allow the tool call (no blocking decision)
exit 0
