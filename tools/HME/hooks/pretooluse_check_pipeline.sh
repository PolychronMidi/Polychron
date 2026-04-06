#!/usr/bin/env bash
# HME PreToolUse: check_pipeline — block repeated calls (polling antipattern).
# pipeline_digest has a freshness guard that auto-checks status; check_pipeline
# should almost never be called directly. One call per turn max.
INPUT=$(cat)

TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // ""')
if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# Count check_pipeline MCP tool calls in the current assistant turn
CALL_COUNT=$(python3 -c "
import json, sys

data = open('$TRANSCRIPT_PATH').read()
lines = data.strip().split('\n')
in_turn = False
count = 0
for line in reversed(lines):
    try:
        obj = json.loads(line)
    except Exception:
        continue
    role = obj.get('role','')
    if role == 'user' and not in_turn:
        continue
    if role == 'assistant':
        in_turn = True
    if role == 'user' and in_turn:
        break
    if in_turn:
        for block in obj.get('content', []):
            if isinstance(block, dict) and block.get('type') == 'tool_use':
                if block.get('name') == 'mcp__HME__check_pipeline':
                    count += 1
print(count)
" 2>/dev/null || echo 0)

if [[ "$CALL_COUNT" -ge 1 ]]; then
  jq -n '{
    "decision": "block",
    "reason": "ANTI-POLLING: check_pipeline already called this turn. The pipeline runs in background and fires a task notification when done. Use pipeline_digest (has freshness guard + auto-status-check). Do substantive work while waiting: implement next evolution, run what_did_i_forget, update KB/docs, explore with module_intel."
  }'
  exit 0
fi

exit 0
