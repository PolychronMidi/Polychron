# LIFESAVER — mid-turn error detection
# LIFE-OR-DEATH: Catch errors that fired in HME Chat DURING this turn.
# Block stopping — errors that appeared while you worked MUST be fixed before return.
# Acknowledging without fixing is the violation this system exists to prevent.
PROJECT="$PROJECT_ROOT"
ERROR_LOG="$PROJECT/log/hme-errors.log"
TURNSTART="$PROJECT/tmp/hme-errors.turnstart"
WATERMARK="$PROJECT/tmp/hme-errors.lastread"
# Heartbeat -- proves Stop-hook lifesaver actually ran.
date +%s > "$PROJECT/tmp/hme-heartbeat-lifesaver.ts" 2>/dev/null || true

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
  # Self-origin source tags: writers that ONLY emit self-health alerts
  # (operator/supervisor concerns, not agent code issues). Lines with
  # these tags are classified as observation-only regardless of severity
  # word (CRITICAL/ERROR included) — the agent has no causal path to
  # fix a CPU-saturated worker daemon, so surfacing as a block-decision
  # is a false-positive that flooded the alert chain. The history note
  # in the original classifier rewrite ("source-tag whitelist that kept
  # missing real failures") referred to GLOBAL whitelisting; this is
  # tighter — only writers in this list, only when matched at the
  # canonical [tag] position at line start.
  _SELF_TAG_RE='^\[(universal_pulse|supervisor|hme-proxy|proxy-bridge|proxy-watchdog|proxy-supervisor|llamacpp_supervisor|llamacpp_offload_invariant|llamacpp_indexing_mode_resume|meta_observer|model_init|rag_proxy\.project|startup_chain|worker:[^]]+)\]'
  _CANARY_RE='\[CANARY-'
  if [ "$TOTAL" -gt "$TURN_START_LINE" ]; then
    NEW_RAW=$(awk "NR > $TURN_START_LINE" "$ERROR_LOG" | sed 's/^\[[0-9TZ:.\-]*\] //' | sort -u)
    # CANARY markers: consume silently; they're alert-chain self-tests
    # that prove the scanner ran. Advance watermark past them but don't
    # surface as alerts.
    _CANARY_LINES=$(printf '%s\n' "$NEW_RAW" | grep -E "$_CANARY_RE" || true)
    if [ -n "$_CANARY_LINES" ]; then
      while IFS= read -r line; do
        # Strip "CANARY-" prefix to match pending-tracker bare-id format.
        cid=$(printf '%s' "$line" | grep -oE 'CANARY-[a-zA-Z0-9-]+' | head -1 | sed 's/^CANARY-//')
        [ -n "$cid" ] && echo "$cid|consumed-by-stop|$(date +%s)" >> "$PROJECT/tmp/hme-canary-consumed.txt" 2>/dev/null
      done <<< "$_CANARY_LINES"
    fi
    # Strip canaries before agent/self classification.
    _NEW_NO_CANARY=$(printf '%s\n' "$NEW_RAW" | grep -vE "$_CANARY_RE" || true)
    # Self-origin = lines tagged with a known self-health writer (regardless
    # of severity word) OR lines with an explicit observation-severity word.
    # Agent-origin = everything else.
    SELF_BY_TAG=$(printf '%s\n' "$_NEW_NO_CANARY" | grep -E "$_SELF_TAG_RE" || true)
    REMAINING=$(printf '%s\n' "$_NEW_NO_CANARY" | grep -vE "$_SELF_TAG_RE" || true)
    AGENT_ERRORS=$(printf '%s\n' "$REMAINING" | grep -vE "$_OBSERVATION_RE" | grep -v '^$' || true)
    SELF_BY_SEV=$(printf '%s\n' "$REMAINING" | grep -E "$_OBSERVATION_RE" | grep -v '^$' || true)
    # Combine self-origin from both axes (tag-based + severity-based).
    SELF_ERRORS=$(printf '%s\n%s\n' "$SELF_BY_TAG" "$SELF_BY_SEV" | grep -v '^$' | sort -u || true)
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
  #
  # Apply the SAME severity + canary filtering as the new-errors branch above.
  # Without this, an alert-chain canary written between turns (or any
  # WARN/INFO/DEBUG/NOTICE-tagged observation entry) would surface as an
  # "UNADDRESSED ERROR" and falsely block — the canary IS addressed (it's
  # consumed silently when scanned), and observation entries are not agent-
  # actionable. This branch was missing the filtering entirely, causing the
  # exact "CANARY-... alert-chain self-test injection" false-block the user
  # just hit. Mirror the agent/self/canary classification used above.
  if [ "$WATERMARK_LINE" -lt "$TURN_START_LINE" ]; then
    UNFIXED_RAW=$(awk "NR > $WATERMARK_LINE && NR <= $TURN_START_LINE" "$ERROR_LOG" \
      | sed 's/^\[[0-9TZ:.\-]*\] //' | sort -u)
    # Consume canaries silently (same as new-errors branch).
    _UNFIXED_CANARY=$(printf '%s\n' "$UNFIXED_RAW" | grep -E "$_CANARY_RE" || true)
    if [ -n "$_UNFIXED_CANARY" ]; then
      while IFS= read -r line; do
        cid=$(printf '%s' "$line" | grep -oE 'CANARY-[a-zA-Z0-9-]+' | head -1 | sed 's/^CANARY-//')
        [ -n "$cid" ] && echo "$cid|consumed-by-stop|$(date +%s)" >> "$PROJECT/tmp/hme-canary-consumed.txt" 2>/dev/null
      done <<< "$_UNFIXED_CANARY"
    fi
    _UNFIXED_NO_CANARY=$(printf '%s\n' "$UNFIXED_RAW" | grep -vE "$_CANARY_RE" || true)
    # Same source-tag + severity-axis classification as the new-errors
    # branch. Self-tagged writers are observation-only regardless of
    # severity word.
    UNFIXED_SELF_BY_TAG=$(printf '%s\n' "$_UNFIXED_NO_CANARY" | grep -E "$_SELF_TAG_RE" || true)
    UNFIXED_REMAINING=$(printf '%s\n' "$_UNFIXED_NO_CANARY" | grep -vE "$_SELF_TAG_RE" || true)
    UNFIXED_AGENT=$(printf '%s\n' "$UNFIXED_REMAINING" | grep -vE "$_OBSERVATION_RE" | grep -v '^$' || true)
    UNFIXED_SELF_BY_SEV=$(printf '%s\n' "$UNFIXED_REMAINING" | grep -E "$_OBSERVATION_RE" | grep -v '^$' || true)
    UNFIXED_SELF=$(printf '%s\n%s\n' "$UNFIXED_SELF_BY_TAG" "$UNFIXED_SELF_BY_SEV" | grep -v '^$' | sort -u || true)
    echo "$TURN_START_LINE" > "$WATERMARK"
    if [ -n "$UNFIXED_AGENT" ]; then
      jq -n \
        --arg errors "$UNFIXED_AGENT" \
        --arg self "$UNFIXED_SELF" \
        '{"decision":"block","reason":("🚨 LIFESAVER — UNADDRESSED ERRORS FROM PREVIOUS TURN:\n" + $errors + (if $self != "" then "\n\n[self-origin (worker/daemon/supervisor — informational, not your problem to fix from this turn):\n" + $self + "]" else "" end) + "\n\nThese errors were shown at turn start but NOT fixed. Fix them now.\nAcknowledging without fixing is a CRITICAL VIOLATION. Do NOT stop.")}'
      _stderr_verdict "BLOCK: lifesaver prior-turn"
      exit 0
    elif [ -n "$UNFIXED_SELF" ]; then
      # Self-origin observations only — surface as additionalContext, don't block.
      jq -n \
        --arg self "$UNFIXED_SELF" \
        '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":("[hme self-health, prior turn] " + $self + "\n(observability only — supervisor/operator concern, not agent action)")}}'
      _stderr_verdict "PASS: lifesaver prior-turn self-only"
      exit 0
    fi
    # Canary-only or empty after filter — silent pass; watermark already advanced.
    _stderr_verdict "PASS: lifesaver prior-turn canary-only"
  fi
fi
