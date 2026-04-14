#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: status(mode='pipeline') — block repeated calls (polling antipattern).
# status has a freshness guard that auto-checks pipeline state; agents that
# call it more than once per turn are polling. One call per turn max.
#
# History: this hook was originally matched to mcp__HME__check_pipeline, a
# tool that never existed post-unification. Retargeted to the status tool
# since status(mode='pipeline') is the canonical replacement.
INPUT=$(cat)

TRANSCRIPT_PATH=$(_safe_jq "$INPUT" '.transcript_path' '')
if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# Only apply to status(mode='pipeline') — other status modes are fine to call
MODE=$(_safe_jq "$INPUT" '.tool_input.mode' '')
if [[ "$MODE" != "pipeline" ]]; then
  exit 0
fi

# Count status(mode='pipeline') calls in the current assistant turn
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
                if block.get('name') == 'mcp__HME__status':
                    if block.get('input', {}).get('mode') == 'pipeline':
                        count += 1
print(count)
" 2>/dev/null || echo 0)

if [[ "$CALL_COUNT" -ge 1 ]]; then
  jq -n '{"hookSpecificOutput":{"permissionDecision":"deny"},"systemMessage":"ANTI-POLLING: status(mode=\"pipeline\") already called this turn. The pipeline runs in background and fires a task notification when done.\n\nInstead:\n- Wait for the background task notification\n- Do real work: implement next evolution, run mcp__HME__review, update KB/docs\n- If you must check freshness, use mcp__HME__review(mode=\"digest\") which has freshness guard"}'
  exit 0
fi

exit 0
