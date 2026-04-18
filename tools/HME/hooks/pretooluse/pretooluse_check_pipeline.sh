#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME PreToolUse dispatcher (called by pretooluse_bash.sh on `i/status` Bash calls).
# Blocks repeated status-polling within a single assistant turn. Status has a
# freshness guard that auto-checks pipeline state; calling it more than once
# per turn is polling. One call per turn max.
INPUT=$(cat)

TRANSCRIPT_PATH=$(_safe_jq "$INPUT" '.transcript_path' '')
if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# Only apply when the command invokes `i/status` (the HME pipeline-status
# wrapper, which maps to the registered _mode_pipeline tool).
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')
if ! echo "$CMD" | grep -qE '(^|[[:space:]/])i/status\b'; then
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
                # HME tools run via Bash(i/<tool>) shell wrappers now — count
                # Bash calls whose command invokes `i/status`. Keep the legacy
                # MCP name too in case historical traces are in the transcript.
                name = block.get('name', '')
                if name == 'Bash':
                    cmd = block.get('input', {}).get('command', '')
                    import re as _re
                    if _re.search(r'(^|[\s/])i/status\b', cmd):
                        count += 1
                elif name in ('HME_status', 'mcp__HME__status'):
                    if block.get('input', {}).get('mode') == 'pipeline':
                        count += 1
print(count)
" 2>/dev/null || echo 0)

if [[ "$CALL_COUNT" -ge 1 ]]; then
  # permissionDecisionReason surfaces to Claude on deny; systemMessage is
  # user-terminal mirror only. Both emitted so Claude sees WHY the tool
  # was blocked AND the user sees the same note in the terminal.
  REASON='ANTI-POLLING: `i/status` already called this turn. The pipeline runs in background and fires a task notification when done.\n\nInstead:\n- Wait for the background task notification\n- Do real work: implement next evolution, run `i/review -- mode=forget`, update KB/docs\n- If you must check freshness, run `i/review -- mode=digest` which has its own freshness guard'
  jq -n --arg reason "$REASON" '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":$reason},"systemMessage":$reason}'
  exit 0
fi

exit 0
