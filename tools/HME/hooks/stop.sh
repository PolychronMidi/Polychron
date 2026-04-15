#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME Stop: enforce implementation completeness + drive autonomous Evolver loop
INPUT=$(cat)

# ── Context meter: merge token counts into existing statusLine data ───────────
# StatusLine writes authoritative used_pct/remaining_pct/size from the API.
# Stop hook only adds input_tokens/output_tokens from the transcript — never
# overwrites used_pct (that would replace real API data with a fabricated estimate).
_CTX_OUT="${HME_CTX_FILE:-/tmp/claude-context.json}"
_CTX_TRANSCRIPT=$(_safe_jq "$INPUT" '.transcript_path' '')
if [[ -n "$_CTX_TRANSCRIPT" && -f "$_CTX_TRANSCRIPT" ]]; then
  python3 -c "
import json,sys
try:
    ctx_file = sys.argv[2]
    try:
        existing = json.loads(open(ctx_file).read())
    except Exception:
        existing = {}
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
                existing['input_tokens']=inp
                existing['output_tokens']=out
                open(ctx_file,'w').write(json.dumps(existing))
                break
except Exception:
    pass
" "$_CTX_TRANSCRIPT" "$_CTX_OUT" 2>/dev/null
fi

# ── Auto-commit snapshot ──────────────────────────────────────────────────────
# Commit any uncommitted changes before lifecycle checks run.
# Timestamps only — no description. Skipped during pipeline runs (run.lock present).
# After commit, the nexus EDIT backlog triggers review(mode='forget') automatically.
_AC_PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
if [ ! -f "$_AC_PROJECT/tmp/run.lock" ]; then
  git -C "$_AC_PROJECT" add -A 2>/dev/null
  if ! git -C "$_AC_PROJECT" commit -m "$(date +%Y-%m-%dT%H:%M:%S)" --quiet 2>/dev/null; then
    # Retry once — transient lock or index contention
    sleep 1
    if ! git -C "$_AC_PROJECT" commit -m "$(date +%Y-%m-%dT%H:%M:%S)-retry" --quiet 2>/dev/null; then
      source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_nexus.sh"
      _nexus_mark COMMIT_FAILED "auto-commit failed twice — uncommitted changes may exist"
      echo "WARNING: auto-commit failed twice. Changes NOT committed. Check git status." >&2
    fi
  else
    # Clear any stale commit-failed flag from a previous failed attempt
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_nexus.sh"
    _nexus_clear_type COMMIT_FAILED
  fi
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
                # Original pipeline markers
                _pipeline_bg = ('npm run main' in cmd or 'npm run snapshot' in cmd or 'node lab/run' in cmd)
                # Widened: any long-running background python/bash process.
                # Training runs, batch analyzers, stress-test batteries all count.
                _generic_bg = (
                    'python3 /tmp/train' in cmd
                    or ('python3' in cmd and ('train' in cmd or 'merge_' in cmd or 'convert_hf_to_gguf' in cmd or 'finetune' in cmd))
                    or 'stress-test' in cmd
                    or 'accelerate launch' in cmd
                    or 'unsloth' in cmd
                    or 'axolotl' in cmd
                    or 'pip3 install' in cmd
                    or 'pip install' in cmd
                    or 'nohup' in cmd
                    or 'trainer.train' in cmd
                )
                if _pipeline_bg or _generic_bg:
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

# ── Psychopathic-stop detection ───────────────────────────────────────────────
# ScheduleWakeup called in the same turn where a long background job was launched
# (or where polling happened) is the "defer-instead-of-work" antipattern. When a
# slow process runs in the background, continue with OTHER real work — do not
# schedule a wakeup and end the turn. Wakeup is reserved for genuinely idle waits
# with no other productive work possible.
if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  PSYCHO_STOP=$(python3 -c "
import json
data = open('$TRANSCRIPT_PATH').read()
lines = data.strip().split('\n')
in_turn = False
saw_bg_launch = False
saw_wakeup = False
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
            if not isinstance(block, dict) or block.get('type') != 'tool_use':
                continue
            name = block.get('name','')
            inp  = block.get('input', {}) or {}
            if name == 'ScheduleWakeup':
                saw_wakeup = True
            if name == 'Bash' and inp.get('run_in_background'):
                cmd = inp.get('command','')
                if any(kw in cmd for kw in ('train', 'pip install', 'pip3 install', 'nohup', 'accelerate', 'axolotl', 'unsloth', 'merge_', 'convert_hf_to_gguf', 'finetune', 'stress-test')):
                    saw_bg_launch = True
print('psycho' if (saw_wakeup and saw_bg_launch) else 'ok')
" 2>/dev/null || echo ok)

  if [[ "$PSYCHO_STOP" == "psycho" ]]; then
    jq -n '{
      "decision": "block",
      "reason": "PSYCHOPATHIC-STOP: You launched a long background process, then called ScheduleWakeup to defer work. This is the stop-during-long-process antipattern. Continue with OTHER real work now — unrelated tasks, KB maintenance, doc updates, code reviews, fixing surfaced warnings. Wakeup is only valid when there is genuinely nothing productive you can do. Resume immediately."
    }'
    exit 0
  fi
fi

# ── Acknowledge-and-move-on detection ────────────────────────────────────────
# Detect: an HME tool in this turn surfaced LIFESAVER CRITICAL/FAIL items, but
# the turn is about to stop without any Edit/Write calls after those surfaces.
# The rule is "fix it, don't just note it" — spawning a sweep Agent, writing a
# doc about it, or saying "I'll park that" instead of editing code is a
# violation. Minimum proof of fixing: at least one Edit/Write tool_use AFTER
# the CRITICAL/FAIL surfaced in a tool_result this turn.
if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  ACK_SKIP=$(python3 -c "
import json
data = open('$TRANSCRIPT_PATH').read()
lines = data.strip().split('\n')
# Walk the current turn in forward order so we can track ordering of
# 'surfaced a failure' vs 'actually edited something after'.
turn_lines: list[dict] = []
found_user = False
for line in reversed(lines):
    try:
        obj = json.loads(line)
    except Exception:
        continue
    role = obj.get('role','')
    if role == 'user' and not found_user:
        found_user = True
    elif role == 'user' and found_user:
        break
    turn_lines.append(obj)
turn_lines.reverse()

surfaced_at = -1  # index where a CRITICAL/FAIL surfaced in a tool result
edit_after = False
for i, obj in enumerate(turn_lines):
    for block in obj.get('content', []):
        if not isinstance(block, dict):
            continue
        if block.get('type') == 'tool_result':
            parts = block.get('content', [])
            # Extract text from result
            text = ''
            if isinstance(parts, list):
                for p in parts:
                    if isinstance(p, dict) and p.get('type') == 'text':
                        text += p.get('text','')
                    elif isinstance(p, str):
                        text += p
            elif isinstance(parts, str):
                text = parts
            if 'LIFESAVER: CRITICAL FAILURES' in text or '[CRITICAL]' in text.upper() or '  FAIL:' in text:
                if surfaced_at == -1:
                    surfaced_at = i
        elif block.get('type') == 'tool_use':
            name = block.get('name','')
            if surfaced_at >= 0 and i > surfaced_at:
                if name in ('Edit', 'Write', 'NotebookEdit'):
                    edit_after = True

if surfaced_at >= 0 and not edit_after:
    print('ack_skip')
else:
    print('ok')
" 2>/dev/null || echo ok)

  if [[ "$ACK_SKIP" == "ack_skip" ]]; then
    jq -n '{
      "decision": "block",
      "reason": "ACKNOWLEDGE-AND-MOVE-ON: HME surfaced a CRITICAL/FAIL this turn but you have not made any Edit/Write calls since. \"Noting\" a failure, \"flagging\" it, saving it for a sweep, or spawning an Agent to survey instead of fixing it is the antipattern the fix_antipattern wiring exists to block. Required action now: diagnose root cause, Edit the offending code, re-run the HME tool to verify the CRITICAL cleared. If the CRITICAL is from a long-running background process that will resolve itself, say so EXPLICITLY in text before stopping — but fix it if you can."
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

# ── Session-end holograph diff ───────────────────────────────────────────────
# Compare the session-start holograph (captured at sessionstart.sh) against
# the current state. Surfaces drift that happened during this session — e.g.,
# a new hook that was added but not registered in hooks.json, a KB entry
# added but not committed, a tool whose docstring was changed. This is where
# the holograph machinery becomes LOAD-BEARING: not just a snapshot, but a
# diff that surfaces unexpected state changes before the agent stops.
SESSION_HOLO="$_AC_PROJECT/tmp/hme-session-start.holograph.json"
HOLO_SCRIPT="$_AC_PROJECT/tools/HME/scripts/snapshot-holograph.py"
if [ -f "$SESSION_HOLO" ] && [ -f "$HOLO_SCRIPT" ]; then
  DIFF_OUT=$(PROJECT_ROOT="$_AC_PROJECT" python3 "$HOLO_SCRIPT" --diff "$SESSION_HOLO" 2>/dev/null)
  if [ -n "$DIFF_OUT" ] && ! echo "$DIFF_OUT" | grep -q "No drift"; then
    # Filter noise — only surface dimensions that actually matter
    FILTERED=$(echo "$DIFF_OUT" | grep -vE "^  (hci|streak|onboarding|git_state|kb_summary|pipeline_history|codebase|todo_store)\.")
    if [ -n "$FILTERED" ] && [ "$(echo "$FILTERED" | wc -l)" -gt 1 ]; then
      echo "$FILTERED" | head -20 >&2
      echo "" >&2
      echo "[session holograph diff: structural changes above — review before stopping]" >&2
    fi
  fi
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
