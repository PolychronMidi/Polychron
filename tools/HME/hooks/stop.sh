#!/usr/bin/env bash
# HME Stop: enforce implementation completeness + drive autonomous Evolver loop
INPUT=$(cat)

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
      TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // ""')
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
# If the transcript shows multiple bash commands reading background task output
# files in this turn, block and redirect. Catches all command forms (tail/cat/
# head/grep/etc.) regardless of path variation.
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // ""')
if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  # Count bash tool calls in the last assistant turn that reference tasks/ output paths
  POLL_COUNT=$(python3 -c "
import json, sys
data = open('$TRANSCRIPT_PATH').read()
lines = data.strip().split('\n')
# Walk backwards to find the most recent assistant turn's tool uses
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
                if block.get('name') == 'Bash':
                    cmd = block.get('input', {}).get('command', '')
                    if '/tasks/' in cmd and '.output' in cmd:
                        count += 1
print(count)
" 2>/dev/null || echo 0)

  if [[ "$POLL_COUNT" -ge 2 ]]; then
    jq -n '{
      "decision": "block",
      "reason": "ANTI-POLLING: You checked background task output multiple times in one turn. This is the wait-and-poll antipattern regardless of command form (tail/cat/head/grep/BashOutput). run_in_background fires a notification — stop checking and do real work instead."
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

# ── Default enforcement reminder ──────────────────────────────────────────────
echo 'STOP. Re-read CLAUDE.md and the user prompt. Did you do ALL the work asked? Every change must be implemented in code, including errors that surface along the way in other involved tools or code (in /src, /tools, or wherever the request is scoped), not just documented. If you skipped anything, go back and do it now.' >&2
exit 0
