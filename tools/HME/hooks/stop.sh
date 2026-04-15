#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME Stop: enforce implementation completeness + drive autonomous Evolver loop.
# Antipattern detection logic lives in tools/HME/scripts/detectors/*.py — each
# detector is a standalone script that reads a transcript path from argv and
# prints a status token. This hook captures tokens and dispatches.
INPUT=$(cat)
_DETECTORS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../scripts/detectors"

# ── Context meter: merge token counts into existing statusLine data ───────────
# StatusLine writes authoritative used_pct/remaining_pct/size from the API.
# Stop hook only adds input_tokens/output_tokens from the transcript — never
# overwrites used_pct (that would replace real API data with a fabricated estimate).
_CTX_OUT="${HME_CTX_FILE:-/tmp/claude-context.json}"
_CTX_TRANSCRIPT=$(_safe_jq "$INPUT" '.transcript_path' '')
if [[ -n "$_CTX_TRANSCRIPT" && -f "$_CTX_TRANSCRIPT" ]]; then
  python3 "$_DETECTORS_DIR/context_meter.py" "$_CTX_TRANSCRIPT" "$_CTX_OUT" 2>/dev/null
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

  # `|| true` on each so set -euo pipefail doesn't kill the stop hook when
  # an optional frontmatter field is absent (grep returns 1 on no-match).
  ENABLED=$(echo "$FM" | grep '^enabled:' | sed 's/enabled: *//' || true)
  ITERATION=$(echo "$FM" | grep '^iteration:' | sed 's/iteration: *//' || true)
  MAX=$(echo "$FM" | grep '^max_iterations:' | sed 's/max_iterations: *//' || true)
  DONE_SIGNAL=$(echo "$FM" | grep '^done_signal:' | sed 's/done_signal: *//' | sed 's/^"\(.*\)"$/\1/' || true)

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
  POLL_COUNT=$(python3 "$_DETECTORS_DIR/poll_count.py" "$TRANSCRIPT_PATH" 2>/dev/null || echo 0)

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
  IDLE_AFTER_BG=$(python3 "$_DETECTORS_DIR/idle_after_bg.py" "$TRANSCRIPT_PATH" 2>/dev/null || echo ok)

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
  PSYCHO_STOP=$(python3 "$_DETECTORS_DIR/psycho_stop.py" "$TRANSCRIPT_PATH" 2>/dev/null || echo ok)

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
  ACK_SKIP=$(python3 "$_DETECTORS_DIR/ack_skip.py" "$TRANSCRIPT_PATH" 2>/dev/null || echo ok)

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
  ABANDON_CHECK=$(python3 "$_DETECTORS_DIR/abandon_check.py" "$TRANSCRIPT_PATH" 2>/dev/null || echo ok)

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
    FILTERED=$(echo "$DIFF_OUT" | grep -vE "^  (hci|streak|onboarding|git_state|kb_summary|pipeline_history|codebase|todo_store)\." || true)
    if [ -n "$FILTERED" ] && [ "$(echo "$FILTERED" | wc -l)" -gt 1 ]; then
      echo "$FILTERED" | head -20 >&2
      echo "" >&2
      echo "[session holograph diff: structural changes above — review before stopping]" >&2
    fi
  fi
fi

# ── HME activity bridge: emit round_complete ─────────────────────────────────
# Snapshots the turn boundary for metrics/hme-activity.jsonl so activity_digest
# can distinguish "this round" from history.
_SESSION_ID_FOR_ACTIVITY=$(_safe_jq "$INPUT" '.session_id' 'unknown')
python3 "$_AC_PROJECT/tools/HME/activity/emit.py" \
  --event=round_complete \
  --session="$_SESSION_ID_FOR_ACTIVITY" >/dev/null 2>&1 &

# ── Default enforcement reminder ──────────────────────────────────────────────
echo 'STOP. Re-read CLAUDE.md and the user prompt. Did you do ALL the work asked? Every change must be implemented in code, including errors that surface along the way in other involved tools or code (in /src, /tools, or wherever the request is scoped), not just documented. If you skipped anything, go back and do it now.' >&2
# Stop-work antipattern: detect when Claude's last turn was text-only with no tool calls,
# or contained dismissive phrases like "No response requested". Both indicate premature stop.
STOP_WORK=$(python3 "$_DETECTORS_DIR/stop_work.py" "$TRANSCRIPT_PATH" 2>/dev/null || echo ok)

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
