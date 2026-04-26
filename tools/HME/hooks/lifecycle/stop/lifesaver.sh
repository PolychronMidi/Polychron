# LIFESAVER — mid-turn error detection
# LIFE-OR-DEATH: Catch errors that fired in HME Chat DURING this turn.
# Block stopping — errors that appeared while you worked MUST be fixed before return.
# Acknowledging without fixing is the violation this system exists to prevent.
PROJECT="$PROJECT_ROOT"
ERROR_LOG="$PROJECT/log/hme-errors.log"
TURNSTART="$PROJECT/tmp/hme-errors.turnstart"
WATERMARK="$PROJECT/tmp/hme-errors.lastread"

if [ -f "$ERROR_LOG" ]; then
  # silent-ok: default-on-missing is load-bearing and documented. The
  # turnstart/watermark state files may legitimately not be present on
  # first run or after a manual state wipe; defaulting to 0 produces
  # correct behavior (first error this turn counts as "new"). A
  # permission-flap on a populated state file is rare and would
  # re-surface on the next turn via the watermark-lag branch below.
  # `wc -l` variant-whitespace stripped via tr; empty-string case
  # handled by the ${VAR:-0} fallback after capture.
  TOTAL=$(wc -l < "$ERROR_LOG" 2>/dev/null | tr -d ' \t' || echo 0)
  TOTAL=${TOTAL:-0}
  TURN_START_LINE=$(cat "$TURNSTART" 2>/dev/null | tr -d ' \t\n' || echo 0)
  TURN_START_LINE=${TURN_START_LINE:-0}
  WATERMARK_LINE=$(cat "$WATERMARK" 2>/dev/null | tr -d ' \t\n' || echo 0)
  WATERMARK_LINE=${WATERMARK_LINE:-0}
  # Inline-mid-turn watermark: PostToolUse hooks already surfaced any new
  # errors that fired during the just-completed turn (via _check_errors_inline).
  # Advance our scan baseline past those so Stop doesn't re-surface duplicates.
  INLINE_WATERMARK_FILE="$PROJECT/tmp/hme-errors.inline-watermark"
  INLINE_WATERMARK=$(cat "$INLINE_WATERMARK_FILE" 2>/dev/null | tr -d ' \t\n' || echo 0)
  INLINE_WATERMARK=${INLINE_WATERMARK:-0}
  if [ "$INLINE_WATERMARK" -gt "$TURN_START_LINE" ]; then
    TURN_START_LINE="$INLINE_WATERMARK"
  fi

  # Recompute TOTAL right before using it for the watermark write so an
  # error appended between initial wc and the awk below doesn't create
  # an off-by-N gap the next turn's "watermark not caught up" branch
  # fails to detect (that branch compares WATERMARK_LINE < TURN_START_LINE,
  # not against current wc -l).
  # Block on NEW errors fired this turn (mid-turn).
  #
  # Severity-based classification (replaces the source-tag whitelist that
  # kept missing real failures). The previous source-classification axis
  # was wrong: tagging by writer (universal_pulse, supervisor, hme-proxy)
  # suppressed CRITICAL events alongside routine WARN noise. The correct
  # axis is severity:
  #
  #   - WARN / INFO / DEBUG  -> observation only (informational)
  #   - ERROR / CRITICAL / FATAL / no-severity-tag -> agent-origin block
  #
  # Lines without a clear severity word default to ERROR -- the error log
  # shouldn't contain non-error content; if a writer logs something, the
  # agent should see it. Routine pulse warnings (p95 latency, etc.) MUST
  # be tagged with WARN to be filtered; otherwise they fire LIFESAVER.
  #
  # History:
  # - "hit restart limit" missed when [supervisor] entries were globally
  #   suppressed -> worker stayed dead 6 hours.
  # - "CRITICAL worker CPU-saturated" missed when [universal_pulse] entries
  #   were globally suppressed -> hooks failed silently, repeatedly.
  # - This rewrite: classify by severity word, not source tag. Any error
  #   surfaces; only explicit informational severities are observation-only.
  _OBSERVATION_RE='\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b'
  if [ "$TOTAL" -gt "$TURN_START_LINE" ]; then
    NEW_RAW=$(awk "NR > $TURN_START_LINE" "$ERROR_LOG" | sed 's/^\[[0-9TZ:.\-]*\] //' | sort -u)
    # Agent-origin = anything without an explicit observation-severity word.
    AGENT_ERRORS=$(printf '%s\n' "$NEW_RAW" | grep -vE "$_OBSERVATION_RE" | grep -v '^$' || true)
    SELF_ERRORS=$(printf '%s\n' "$NEW_RAW" | grep -E "$_OBSERVATION_RE" | grep -v '^$' || true)
    # Re-read line count AFTER the awk consumed its snapshot so watermark matches.
    TOTAL=$(wc -l < "$ERROR_LOG" 2>/dev/null | tr -d ' \t' || echo 0)
    TOTAL=${TOTAL:-0}
    echo "$TOTAL" > "$WATERMARK"
    echo "$TOTAL" > "$TURNSTART"
    if [ -n "$AGENT_ERRORS" ]; then
      jq -n \
        --arg errors "$AGENT_ERRORS" \
        --arg self "$SELF_ERRORS" \
        '{"decision":"block","reason":("🚨 LIFESAVER — AGENT-ORIGIN ERRORS FIRED THIS TURN:\n" + $errors + (if $self != "" then "\n\n[self-origin (worker/daemon/supervisor — informational, not your problem to fix from this turn):\n" + $self + "]" else "" end) + "\n\nYou MUST: 1) diagnose root cause  2) implement fix  3) verify fix.\nAcknowledging without fixing is a CRITICAL VIOLATION. Do NOT stop.")}'
      _stderr_verdict "BLOCK: lifesaver $((TOTAL - TURN_START_LINE))err"
      exit 0
    elif [ -n "$SELF_ERRORS" ]; then
      # Self-origin only — surface as observation, do not block. The
      # operator/supervisor handles these; the agent has no causal path.
      jq -n \
        --arg self "$SELF_ERRORS" \
        '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":("[hme self-health] " + $self + "\n(observability only — supervisor/operator concern, not agent action)")}}'
      _stderr_verdict "PASS: lifesaver self-only"
      exit 0
    fi
  fi

  # Block on UNADDRESSED errors from before this turn (watermark not caught up)
  # This fires when userpromptsubmit showed errors but they were not fixed last turn.
  if [ "$WATERMARK_LINE" -lt "$TURN_START_LINE" ]; then
    UNFIXED_ERRORS=$(awk "NR > $WATERMARK_LINE && NR <= $TURN_START_LINE" "$ERROR_LOG" \
      | sed 's/^\[[0-9TZ:.\-]*\] //' | sort -u)
    echo "$TURN_START_LINE" > "$WATERMARK"
    jq -n \
      --arg errors "$UNFIXED_ERRORS" \
      '{"decision":"block","reason":("🚨 LIFESAVER — UNADDRESSED ERRORS FROM PREVIOUS TURN:\n" + $errors + "\n\nThese errors were shown at turn start but NOT fixed. Fix them now.\nAcknowledging without fixing is a CRITICAL VIOLATION. Do NOT stop.")}'
    _stderr_verdict "BLOCK: lifesaver prior-turn"
    exit 0
  fi
fi
