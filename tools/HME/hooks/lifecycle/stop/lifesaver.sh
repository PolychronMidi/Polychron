# LIFESAVER — mid-turn error detection
# LIFE-OR-DEATH: Catch errors that fired in HME Chat DURING this turn.
# Block stopping — errors that appeared while you worked MUST be fixed before return.
# Acknowledging without fixing is the violation this system exists to prevent.
PROJECT="$PROJECT_ROOT"
ERROR_LOG="$PROJECT/log/hme-errors.log"
TURNSTART="$PROJECT/tmp/hme-errors.turnstart"
WATERMARK="$PROJECT/tmp/hme-errors.lastread"

if [ -f "$ERROR_LOG" ]; then
  # Strip whitespace + default to 0 on empty/missing files. `wc -l` on
  # some builds emits leading whitespace (`   123`), and an existing-but-
  # empty TURNSTART/WATERMARK makes `cat` succeed with "", which breaks
  # every downstream integer test ([ "" -gt N ] → "integer expression
  # expected", silently aborting the block). The `${VAR:-0}` pattern
  # after capture + `tr` to strip whitespace handles both classes.
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
  # Block on NEW errors fired this turn (mid-turn)
  if [ "$TOTAL" -gt "$TURN_START_LINE" ]; then
    # Strip ISO timestamps before dedup so identical messages with different
    # timestamps collapse to one line instead of spamming N copies.
    NEW_ERRORS=$(awk "NR > $TURN_START_LINE" "$ERROR_LOG" \
      | sed 's/^\[[0-9TZ:.\-]*\] //' | sort -u)
    # Re-read line count AFTER the awk consumed its snapshot so the
    # watermark matches what we actually reported (no drift).
    TOTAL=$(wc -l < "$ERROR_LOG" 2>/dev/null | tr -d ' \t' || echo 0)
    TOTAL=${TOTAL:-0}
    echo "$TOTAL" > "$WATERMARK"
    echo "$TOTAL" > "$TURNSTART"
    jq -n \
      --arg errors "$NEW_ERRORS" \
      '{"decision":"block","reason":("🚨 LIFESAVER — ERRORS FIRED DURING THIS TURN:\n" + $errors + "\n\nYou MUST: 1) diagnose root cause  2) implement fix  3) verify fix.\nAcknowledging without fixing is a CRITICAL VIOLATION. Do NOT stop.")}'
    _stderr_verdict "BLOCK: lifesaver $((TOTAL - TURN_START_LINE))err"
    exit 0
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
