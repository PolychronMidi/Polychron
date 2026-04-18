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

# Count status(mode='pipeline') calls in the current assistant turn. Also
# track parse failures — a handful of malformed lines is expected, but if
# EVERY line fails to parse, the transcript format has drifted and the
# polling guard is silently disabled. Surface that to hme-errors.log.
_STATUS_COUNT_PARSE=$(python3 - "$TRANSCRIPT_PATH" <<'PYEOF' 2>/dev/null
import json, os, re, sys
path = sys.argv[1]
try:
    data = open(path).read()
except Exception as e:
    # Transcript unreadable — emit sentinel so the shell layer can log.
    print(f"0 UNREADABLE:{type(e).__name__}")
    sys.exit(0)
lines = data.strip().split('\n')
in_turn = False
count = 0
parse_fail = 0
parse_ok = 0
status_re = re.compile(r'(^|[\s/])i/status\b')
for line in reversed(lines):
    try:
        obj = json.loads(line)
        parse_ok += 1
    except Exception:
        parse_fail += 1
        continue
    role = obj.get('role', '')
    if role == 'user' and not in_turn:
        continue
    if role == 'assistant':
        in_turn = True
    if role == 'user' and in_turn:
        break
    if in_turn:
        for block in obj.get('content', []):
            if isinstance(block, dict) and block.get('type') == 'tool_use':
                name = block.get('name', '')
                if name == 'Bash':
                    cmd = block.get('input', {}).get('command', '')
                    if status_re.search(cmd):
                        count += 1
                elif name in ('HME_status', 'mcp__HME__status'):
                    if block.get('input', {}).get('mode') == 'pipeline':
                        count += 1
# Emit: <count> <sentinel-or-nothing>. Sentinel ALL_PARSE_FAILED fires when
# we saw lines but parsed none — format drift, polling guard ineffective.
if parse_ok == 0 and parse_fail > 10:
    print(f"{count} ALL_PARSE_FAILED:{parse_fail}")
else:
    print(count)
PYEOF
)
CALL_COUNT=$(echo "$_STATUS_COUNT_PARSE" | awk '{print $1}')
_SENTINEL=$(echo "$_STATUS_COUNT_PARSE" | awk '{print $2}')
if [ -n "$_SENTINEL" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
  printf '[%s] [pretooluse_check_pipeline] transcript parse drift: %s (polling guard ineffective)\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$_SENTINEL" >> "$PROJECT_ROOT/log/hme-errors.log" 2>/dev/null
fi
CALL_COUNT="${CALL_COUNT:-0}"

if [[ "$CALL_COUNT" -ge 1 ]]; then
  # permissionDecisionReason surfaces to Claude on deny; systemMessage is
  # user-terminal mirror only. Both emitted so Claude sees WHY the tool
  # was blocked AND the user sees the same note in the terminal.
  REASON='ANTI-POLLING: `i/status` already called this turn. The pipeline runs in background and fires a task notification when done.\n\nInstead:\n- Wait for the background task notification\n- Do real work: implement next evolution, run `i/review -- mode=forget`, update KB/docs\n- If you must check freshness, run `i/review -- mode=digest` which has its own freshness guard'
  jq -n --arg reason "$REASON" '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":$reason},"systemMessage":$reason}'
  exit 0
fi

exit 0
