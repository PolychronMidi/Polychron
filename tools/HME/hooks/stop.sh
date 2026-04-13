#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME Stop: enforce implementation completeness + drive autonomous Evolver loop
INPUT=$(cat)

# ── Context meter: runs before any exit so /tmp/claude-context.json is always fresh ──
# Stop hook fires BEFORE the next `> ` prompt — by the time PTY initBuf detects
# the prompt, this file is already written with the current turn's real token counts.
_CTX_TRANSCRIPT=$(_safe_jq "$INPUT" '.transcript_path' '')
if [[ -n "$_CTX_TRANSCRIPT" && -f "$_CTX_TRANSCRIPT" ]]; then
  python3 -c "
import json,sys
try:
    with open(sys.argv[1]) as f:
        lines=[l for l in f if l.strip()]
    for line in reversed(lines):
        obj=json.loads(line)
        if obj.get('type')=='assistant':
            u=obj.get('message',{}).get('usage',{})
            if u:
                inp=(u.get('input_tokens',0)+u.get('cache_read_input_tokens',0)
                     +u.get('cache_creation_input_tokens',0))
                out=u.get('output_tokens',0)
                w=200000
                used=round((inp+out)/w*100)
                open('/tmp/claude-context.json','w').write(
                    json.dumps({'used_pct':used,'remaining_pct':100-used,
                                'size':w,'input_tokens':inp,'output_tokens':out}))
                break
except Exception:
    pass
" "$_CTX_TRANSCRIPT" 2>/dev/null
fi

# ── LIFESAVER — mid-turn error detection ──────────────────────────────────────
# LIFE-OR-DEATH: Catch errors that fired in HME Chat DURING this turn.
# Block stopping — errors that appeared while you worked MUST be fixed before return.
# Acknowledging without fixing is the violation this system exists to prevent.
PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
ERROR_LOG="$PROJECT/log/hme-errors.log"
TURNSTART="$PROJECT/tmp/hme-errors.turnstart"
WATERMARK="$PROJECT/tmp/hme-errors.lastread"

if [ -f "$ERROR_LOG" ]; then
  TOTAL=$(wc -l < "$ERROR_LOG" 2>/dev/null || echo 0)
  TURN_START_LINE=$(cat "$TURNSTART" 2>/dev/null || echo 0)
  WATERMARK_LINE=$(cat "$WATERMARK" 2>/dev/null || echo 0)

  # Block on NEW errors fired this turn (mid-turn)
  if [ "$TOTAL" -gt "$TURN_START_LINE" ]; then
    NEW_ERRORS=$(awk "NR > $TURN_START_LINE" "$ERROR_LOG" | sort -u)
    echo "$TOTAL" > "$WATERMARK"
    echo "$TOTAL" > "$TURNSTART"
    jq -n \
      --arg errors "$NEW_ERRORS" \
      '{"decision":"block","reason":("🚨 LIFESAVER — ERRORS FIRED DURING THIS TURN:\n" + $errors + "\n\nYou MUST: 1) diagnose root cause  2) implement fix  3) verify fix.\nAcknowledging without fixing is a CRITICAL VIOLATION. Do NOT stop.")}'
    exit 0
  fi

  # Block on UNADDRESSED errors from before this turn (watermark not caught up)
  # This fires when userpromptsubmit showed errors but they were not fixed last turn.
  if [ "$WATERMARK_LINE" -lt "$TURN_START_LINE" ]; then
    UNFIXED_ERRORS=$(awk "NR > $WATERMARK_LINE && NR <= $TURN_START_LINE" "$ERROR_LOG" | sort -u)
    echo "$TURN_START_LINE" > "$WATERMARK"
    jq -n \
      --arg errors "$UNFIXED_ERRORS" \
      '{"decision":"block","reason":("🚨 LIFESAVER — UNADDRESSED ERRORS FROM PREVIOUS TURN:\n" + $errors + "\n\nThese errors were shown at turn start but NOT fixed. Fix them now.\nAcknowledging without fixing is a CRITICAL VIOLATION. Do NOT stop.")}'
    exit 0
  fi
fi

# ── Evolver Loop (ralph-loop pattern) ─────────────────────────────────────────
# When .claude/hme-evolver.local.md exists, block exit and inject next iteration.
LOOP_FILE="$CLAUDE_PROJECT_DIR/.claude/hme-evolver.local.md"

if [[ -f "$LOOP_FILE" ]]; then
  # Parse frontmatter
  FM=$(sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$LOOP_FILE")

  ENABLED=$(echo "$FM" | grep '^enabled:' | sed 's/enabled: *//')
  ITERATION=$(echo "$FM" | grep '^iteration:' | sed 's/iteration: *//')
  MAX=$(echo "$FM" | grep '^max_iterations:' | sed 's/max_iterations: *//')
  DONE_SIGNAL=$(echo "$FM" | grep '^done_signal:' | sed 's/done_signal: *//' | sed 's/^"\(.*\)"$/\1/')

  # Skip if disabled
  if [[ "$ENABLED" != "true" ]]; then
    echo 'Evolver loop present but disabled.' >&2
  else
    ITERATION=${ITERATION:-1}
    MAX=${MAX:-0}

    # Check max iterations cap
    if [[ "$MAX" -gt 0 && "$ITERATION" -ge "$MAX" ]]; then
      echo "Evolver loop: max iterations ($MAX) reached. Removing loop file." >&2
      rm "$LOOP_FILE"
    else
      # Check transcript for done_signal
      TRANSCRIPT_PATH=$(_safe_jq "$INPUT" '.transcript_path' '')
      DONE=false
      if [[ -n "$DONE_SIGNAL" && -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
        if grep -q "$DONE_SIGNAL" "$TRANSCRIPT_PATH" 2>/dev/null; then
          DONE=true
        fi
      fi

      if [[ "$DONE" == "true" ]]; then
        echo "Evolver loop: done signal detected. Removing loop file." >&2
        rm "$LOOP_FILE"
      else
        # Extract prompt body (everything after second ---)
        NEXT_PROMPT=$(awk '/^---$/{i++; next} i>=2' "$LOOP_FILE")

        # Increment iteration atomically
        NEXT_ITER=$((ITERATION + 1))
        TEMP="${LOOP_FILE}.tmp.$$"
        sed "s/^iteration: .*/iteration: $NEXT_ITER/" "$LOOP_FILE" > "$TEMP"
        mv "$TEMP" "$LOOP_FILE"

        # Block exit and inject next evolution prompt
        jq -n \
          --arg prompt "$NEXT_PROMPT" \
          --argjson iter "$NEXT_ITER" \
          --argjson max "$MAX" \
          '{
            "decision": "block",
            "reason": $prompt,
            "systemMessage": ("Evolver loop: iteration " + ($iter|tostring) + (if $max > 0 then "/" + ($max|tostring) else "" end))
          }'
        exit 0
      fi
    fi
  fi
fi

# ── Background task polling detection ─────────────────────────────────────────
# Catches both Bash-based polling (task output files) and MCP tool polling
# (repeated check_pipeline calls). Both are the same antipattern.
TRANSCRIPT_PATH=$(_safe_jq "$INPUT" '.transcript_path' '')
if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  POLL_COUNT=$(python3 -c "
import json, sys
data = open('$TRANSCRIPT_PATH').read()
lines = data.strip().split('\n')
in_turn = False
bash_polls = 0
mcp_polls = 0
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
                name = block.get('name', '')
                if name == 'Bash':
                    cmd = block.get('input', {}).get('command', '')
                    if '/tasks/' in cmd and '.output' in cmd:
                        bash_polls += 1
                elif name == 'mcp__HME__check_pipeline':
                    mcp_polls += 1
print(max(bash_polls, mcp_polls))
" 2>/dev/null || echo 0)

  if [[ "$POLL_COUNT" -ge 2 ]]; then
    jq -n '{
      "decision": "block",
      "reason": "ANTI-POLLING: You polled pipeline/task status multiple times in one turn. This is the wait-and-poll antipattern. Background tasks fire notifications when done — use pipeline_digest (freshness guard) or do real work instead."
    }'
    exit 0
  fi
fi

# ── Background-launch-then-idle detection ────────────────────────────────────
# If a pipeline was launched in background, block stopping until either:
#   a) The output file signals pipeline completion, OR
#   b) 20+ tool calls have been made after the launch (enough real work done)
if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  IDLE_AFTER_BG=$(python3 -c "
import json, os, re, sys

data = open('$TRANSCRIPT_PATH').read()
lines = data.strip().split('\n')
in_turn = False
found_bg = False
calls_after_bg = 0
bg_output_path = None

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
            if not isinstance(block, dict):
                continue
            # Capture background task output path from tool result
            if block.get('type') == 'tool_result':
                for part in block.get('content', []):
                    if isinstance(part, dict) and part.get('type') == 'text':
                        m = re.search(r'Output is being written to: (\S+)', part.get('text',''))
                        if m and bg_output_path is None:
                            bg_output_path = m.group(1)
            if block.get('type') != 'tool_use':
                continue
            inp = block.get('input', {})
            if block.get('name') == 'Bash' and inp.get('run_in_background'):
                cmd = inp.get('command', '')
                if 'npm run main' in cmd or 'npm run snapshot' in cmd or 'node lab/run' in cmd:
                    found_bg = True
            elif found_bg:
                calls_after_bg += 1

if not found_bg:
    print('ok')
    sys.exit(0)

# Check if pipeline output file signals completion
if bg_output_path and os.path.isfile(bg_output_path):
    try:
        tail = open(bg_output_path).read()[-2000:]
        # npm run main ends with success/error markers
        done_signals = ['Pipeline complete', 'pipeline complete', 'npm ERR!', 'Snapshot saved',
                        'error Command failed', 'DONE', 'Finished in', 'exited with code']
        if any(sig in tail for sig in done_signals):
            # Pipeline done — still require minimum work was done
            print('idle' if calls_after_bg < 5 else 'ok')
            sys.exit(0)
    except Exception:
        pass

# Pipeline still running (or output not readable): require 20 real calls
print('idle' if calls_after_bg < 20 else 'ok')
" 2>/dev/null || echo ok)

  if [[ "$IDLE_AFTER_BG" == "idle" ]]; then
    jq -n '{
      "decision": "block",
      "reason": "ANTI-IDLE: Pipeline is running in background — do NOT stop. Continue with real work now:\n1. Run index_codebase (KB stays fresh for next round)\n2. Pick next evolution targets from the suggest_evolution output and implement them\n3. Run what_did_i_forget on any recently changed files\n4. Update docs or KB entries for this round\nDo not end your turn until the pipeline completes or you have done 20+ tool calls of substantive work."
    }'
    exit 0
  fi
fi

# ── Plan-abandonment detection ────────────────────────────────────────────────
# Detect: Agent spawned for KB/HME work (should use HME tools directly),
# or a sweep was started (edit/grep loop) but fewer than expected completions.
if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  ABANDON_CHECK=$(python3 -c "
import json, sys
data = open('$TRANSCRIPT_PATH').read()
lines = data.strip().split('\n')
in_turn = False
agent_for_kb = False
edits_started = 0
edits_note = ''

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
            if not isinstance(block, dict): continue
            if block.get('type') == 'tool_use':
                name = block.get('name','')
                inp = block.get('input', {})
                # Agent spawned for KB/HME work
                if name == 'Agent':
                    prompt = inp.get('prompt','').lower()
                    if any(kw in prompt for kw in ['knowledge', 'kb ', 'hme', 'search_knowledge', 'compact', 'remove_knowledge']):
                        agent_for_kb = True
                # Count edits — proxy for sweep progress
                if name == 'Edit':
                    edits_started += 1

if agent_for_kb:
    print('AGENT_FOR_KB')
else:
    print('ok')
" 2>/dev/null || echo ok)

  if [[ "$ABANDON_CHECK" == "AGENT_FOR_KB" ]]; then
    jq -n '{
      "decision": "block",
      "reason": "PLAN-ABANDONMENT DETECTED: You spawned an Agent for KB/HME work. Use HME tools directly: search_knowledge, compact_knowledge, remove_knowledge, list_knowledge, memory_dream, kb_health. Subagents for KB work are the abandoning-plans antipattern (KB entry 524061657661). Complete the task using HME tools now."
    }'
    exit 0
  fi
fi

# ── Nexus lifecycle audit ────────────────────────────────────────────────────
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_nexus.sh"
NEXUS_ISSUES=$(_nexus_pending)
if [ -n "$NEXUS_ISSUES" ]; then
  jq -n \
    --arg issues "$NEXUS_ISSUES" \
    '{"decision":"block","reason":("NEXUS — incomplete lifecycle steps:" + $issues + "\n\nFinish these before stopping.")}'
  exit 0
fi

# ── Default enforcement reminder ──────────────────────────────────────────────
echo 'STOP. Re-read CLAUDE.md and the user prompt. Did you do ALL the work asked? Every change must be implemented in code, including errors that surface along the way in other involved tools or code (in /src, /tools, or wherever the request is scoped), not just documented. If you skipped anything, go back and do it now.' >&2
# Stop-work antipattern: detect when Claude's last turn was text-only with no tool calls,
# or contained dismissive phrases like "No response requested". Both indicate premature stop.
STOP_WORK=$(python3 -c "
import json, sys
data = open('$TRANSCRIPT_PATH').read()
lines = data.strip().split('\n')
# Find the last assistant message
for line in reversed(lines):
    try:
        obj = json.loads(line)
    except Exception:
        continue
    if obj.get('role') == 'assistant':
        blocks = obj.get('content', [])
        has_tool_use = any(isinstance(b, dict) and b.get('type') == 'tool_use' for b in blocks)
        text_parts = [b.get('text','') for b in blocks if isinstance(b, dict) and b.get('type') == 'text']
        full_text = ' '.join(text_parts).strip().lower()
        dismissive = ['no response requested', 'nothing to do', 'no action needed',
                      'no further action', 'no work remaining', 'all done']
        if any(d in full_text for d in dismissive):
            print('DISMISSIVE')
        elif not has_tool_use and len(full_text) < 200:
            print('TEXT_ONLY_SHORT')
        else:
            print('ok')
        sys.exit(0)
    elif obj.get('role') == 'user':
        break
print('ok')
" 2>/dev/null || echo ok)

if [[ "$STOP_WORK" == "DISMISSIVE" ]]; then
  jq -n '{
    "decision": "block",
    "reason": "STOP-WORK ANTIPATTERN: You responded with dismissive text instead of doing work. Re-read the user prompt and the conversation. There is always pending work after a user message — find it and do it. If genuinely nothing remains, explain what was completed and why."
  }'
  exit 0
fi
if [[ "$STOP_WORK" == "TEXT_ONLY_SHORT" ]]; then
  jq -n '{
    "decision": "block",
    "reason": "STOP-WORK ANTIPATTERN: Your last turn was a short text-only response with no tool calls. If there is remaining work, continue it now. If you genuinely completed everything, provide a substantive summary of what was done."
  }'
  exit 0
fi
