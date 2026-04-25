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

  # Recompute TOTAL right before using it for the watermark write so an
  # error appended between initial wc and the awk below doesn't create
  # an off-by-N gap the next turn's "watermark not caught up" branch
  # fails to detect (that branch compares WATERMARK_LINE < TURN_START_LINE,
  # not against current wc -l).
  # Block on NEW errors fired this turn (mid-turn).
  #
  # Source-classification (peer-review iter 130 fix): the error log is
  # written by multiple actors. Self-origin entries (worker GIL hangs,
  # daemon crashloops, supervisor child-exit failures) cannot be fixed
  # from inside an agent turn — surfacing them as "you MUST fix" causes
  # the agent to attempt remediation it has no causal access to.
  # Classify by source-tag prefix; agent-origin → demand-register block,
  # self-origin → reveal-register observation passed through (no block).
  # Self-origin patterns are documented in writers' source: `[universal_pulse]`,
  # `[supervisor]`, `[hme-proxy] inline`, `meta_observer`, `daemon crashloop`,
  # `claude-arbiter CPU`, `worker self-terminated`.
  _SELF_ORIGIN_RE='\[universal_pulse\]|\[supervisor\]|\[hme-proxy\]|meta_observer|daemon crashloop|claude-arbiter CPU|worker self-terminated|llamacpp_daemon'
  if [ "$TOTAL" -gt "$TURN_START_LINE" ]; then
    NEW_RAW=$(awk "NR > $TURN_START_LINE" "$ERROR_LOG" | sed 's/^\[[0-9TZ:.\-]*\] //' | sort -u)
    AGENT_ERRORS=$(printf '%s\n' "$NEW_RAW" | grep -vE "$_SELF_ORIGIN_RE" || true)
    SELF_ERRORS=$(printf '%s\n' "$NEW_RAW" | grep -E "$_SELF_ORIGIN_RE" || true)
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
