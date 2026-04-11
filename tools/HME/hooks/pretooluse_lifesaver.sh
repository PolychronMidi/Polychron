#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# LIFESAVER PreToolUse — stamp start time for every tool call.
# PostToolUse (log-tool-call.sh) reads this to compute elapsed and emit
# warnings when MCP HME synthesis calls take longer than expected.
INPUT=$(cat)
TOOL_NAME=$(_safe_jq "$INPUT" '.tool_name' '')
SESSION_ID=$(_safe_jq "$INPUT" '.session_id' 'default')
# Sanitize tool name for use in filename
SAFE_NAME=$(printf '%s' "$TOOL_NAME" | tr -c 'a-zA-Z0-9_-' '_')
echo "$(date +%s%3N)" > "/tmp/hme_lifesaver_${SESSION_ID}_${SAFE_NAME}" 2>/dev/null
exit 0
