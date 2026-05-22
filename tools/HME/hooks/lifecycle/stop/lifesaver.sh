# LIFESAVER -- mid-turn error detection
# LIFE-OR-DEATH: Catch errors that fired in HME components DURING this turn.
# Block stopping -- errors that appeared while you worked MUST be fixed before return.
# Acknowledging without fixing is the violation this system exists to prevent.
PROJECT="$PROJECT_ROOT"
ERROR_LOG="$PROJECT/log/hme-errors.log"
TURNSTART="$PROJECT/tools/HME/runtime/errors-turnstart"
WATERMARK="$PROJECT/tools/HME/runtime/errors-lastread"
# Heartbeat -- proves Stop-hook lifesaver actually ran.
date +%s > "$PROJECT/tools/HME/runtime/heartbeat-lifesaver.ts" 2>/dev/null || true

if [ -f "$ERROR_LOG" ]; then
  # silent-ok: default-on-missing (turnstart/watermark may be absent on
  # first run / state wipe; 0 = treat first error as new).
  TOTAL=$(wc -l < "$ERROR_LOG" 2>/dev/null | tr -d ' \t' || echo 0)
  TOTAL=${TOTAL:-0}
  TURN_START_LINE=$(cat "$TURNSTART" 2>/dev/null | tr -d ' \t\n' || echo 0)
  TURN_START_LINE=${TURN_START_LINE:-0}
  WATERMARK_LINE=$(cat "$WATERMARK" 2>/dev/null | tr -d ' \t\n' || echo 0)
  WATERMARK_LINE=${WATERMARK_LINE:-0}
  # Inline-mid-turn watermark: PostToolUse hooks already surfaced any new
  INLINE_WATERMARK_FILE="$PROJECT/tmp/hme-errors.inline-watermark"
  INLINE_WATERMARK=$(cat "$INLINE_WATERMARK_FILE" 2>/dev/null | tr -d ' \t\n' || echo 0)
  INLINE_WATERMARK=${INLINE_WATERMARK:-0}
  if [ "$INLINE_WATERMARK" -gt "$TURN_START_LINE" ]; then
    TURN_START_LINE="$INLINE_WATERMARK"
  fi

  # Recompute TOTAL pre-watermark to avoid off-by-N if a writer appends mid-block.
  _OBSERVATION_RE='\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b'
  # Self-origin source tags: writers emit only self-health alerts (not
  _SELF_TAG_RE='^\[(_safe_curl|_safe_jq|_safe_py3|universal_pulse|supervisor|hme-proxy|proxy-bridge|proxy-watchdog|hook-watchdog|hook-stop-block|hook-runtime-error|hook-ui-echo-leak|proxy-supervisor|llamacpp_supervisor|llamacpp_offload_invariant|llamacpp_indexing_mode_resume|meta_observer|model_init|rag_proxy\.project|startup_chain|worker_client|worker:[^]]+|HCI trajectory)\]'
  _STATUS_LINE_RE='^(Onboarding:|Pipeline:|Last commit:|Carried-over HME todos|substrate:|[[:space:]]*\[[[:space:]]?\][[:space:]]*#[0-9]+|[[:space:]]*->[[:space:]]*\[arc_v_blindspot\])'
  _CANARY_RE='\[CANARY-'
  _hme_stale_runtime_resolved_or_grace() {
    local head live marker first marker_head now grace
    head=$(git -C "$PROJECT" rev-parse --short HEAD 2>/dev/null || true)
    live=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("git_sha") or "")' "$PROJECT/tools/HME/runtime/proxy-runtime.json" 2>/dev/null || true)
    [ -n "$head" ] && [ -n "$live" ] && [ "$head" = "$live" ] && return 0
    marker="$PROJECT/tools/HME/runtime/post-commit-stale-runtime.json"
    [ -f "$marker" ] || return 1
    first=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("first_seen_epoch") or "")' "$marker" 2>/dev/null || true)
    marker_head=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("head_sha") or "")' "$marker" 2>/dev/null || true)
    case "$first" in ''|*[!0-9]*) return 1 ;; esac
    [ -n "$head" ] && [ -n "$marker_head" ] && [ "$head" != "$marker_head" ] && return 1
    now=$(date +%s)
    grace="${HME_POST_COMMIT_STALE_GRACE_SEC:-120}"
    case "$grace" in ''|*[!0-9]*) grace=120 ;; esac
    [ $((now - first)) -lt "$grace" ]
  }
  if [ "$TOTAL" -gt "$TURN_START_LINE" ]; then
    NEW_RAW=$(awk "NR > $TURN_START_LINE" "$ERROR_LOG" | sed 's/^\[[0-9TZ:.\-]*\] //' | sort -u)
    # CANARY markers: consume silently; they're alert-chain self-tests
    _CANARY_LINES=$(printf '%s\n' "$NEW_RAW" | grep -E "$_CANARY_RE" || true)
    if [ -n "$_CANARY_LINES" ]; then
      while IFS= read -r line; do
        # Strip "CANARY-" prefix to match pending-tracker bare-id format.
        cid=$(printf '%s' "$line" | grep -oE 'CANARY-[a-zA-Z0-9-]+' | head -1 | sed 's/^CANARY-//')
        [ -n "$cid" ] && echo "$cid|consumed-by-stop|$(date +%s)" >> "$PROJECT/tmp/hme-canary-consumed.txt" 2>/dev/null  # silent-ok: optional fallback path.
      done <<< "$_CANARY_LINES"
    fi
    # Strip canaries before agent/self classification.
    _NEW_NO_CANARY=$(printf '%s\n' "$NEW_RAW" | grep -vE "$_CANARY_RE" | grep -vE "$_STATUS_LINE_RE" || true)
    if _hme_stale_runtime_resolved_or_grace; then
      _NEW_NO_CANARY=$(printf '%s\n' "$_NEW_NO_CANARY" | grep -v '\[stale_runtime\]' || true)
    fi
    # Self-origin = lines tagged with a known self-health writer (regardless
    SELF_BY_TAG=$(printf '%s\n' "$_NEW_NO_CANARY" | grep -E "$_SELF_TAG_RE" || true)
    REMAINING=$(printf '%s\n' "$_NEW_NO_CANARY" | grep -vE "$_SELF_TAG_RE" || true)
    AGENT_ERRORS=$(printf '%s\n' "$REMAINING" | grep -vE "$_OBSERVATION_RE" | grep -v '^$' || true)
    SELF_BY_SEV=$(printf '%s\n' "$REMAINING" | grep -E "$_OBSERVATION_RE" | grep -v '^$' || true)
    # Combine self-origin from both axes (tag-based + severity-based).
    SELF_ERRORS=$(printf '%s\n%s\n' "$SELF_BY_TAG" "$SELF_BY_SEV" | grep -v '^$' | sort -u || true)
    # Re-read line count AFTER the awk consumed its snapshot so watermark matches.
    TOTAL=$(wc -l < "$ERROR_LOG" 2>/dev/null | tr -d ' \t' || echo 0)  # silent-ok: optional fallback path.
    TOTAL=${TOTAL:-0}
    echo "$TOTAL" > "$WATERMARK"
    echo "$TOTAL" > "$TURNSTART"
    if [ -n "$AGENT_ERRORS" ]; then
      jq -n \
        --arg errors "$AGENT_ERRORS" \
        --arg self "$SELF_ERRORS" \
        '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":("[ALERT] LIFESAVER -- AGENT-ORIGIN ERRORS FIRED THIS TURN:\n" + $errors + (if $self != "" then "\n\n[self-origin (worker/daemon/supervisor):\n" + $self + "]" else "" end) + "\n\nDiagnose root cause, implement fix, verify. Acknowledging without fixing is a CRITICAL VIOLATION.")},"decision":"block","reason":"LIFESAVER: AGENT-ORIGIN ERRORS FIRED THIS TURN"}'
      _stderr_verdict "FAIL: lifesaver $((TOTAL - TURN_START_LINE))err"
      exit 0
    elif [ -n "$SELF_ERRORS" ]; then
      # Self-origin only -- surface as observation, do not block. The
      # operator/supervisor handles these; the agent has no causal path.
      jq -n \
        --arg self "$SELF_ERRORS" \
        '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":("[hme self-health] " + $self + "\n(observability only -- supervisor/operator concern, not agent action)")}}'
      _stderr_verdict "PASS: lifesaver self-only"
      exit 0
    fi
  fi

  # Surface UNADDRESSED errors from prior turn (watermark < turnstart).
  if [ "$WATERMARK_LINE" -lt "$TURN_START_LINE" ]; then
    UNFIXED_RAW=$(awk "NR > $WATERMARK_LINE && NR <= $TURN_START_LINE" "$ERROR_LOG" \
      | sed 's/^\[[0-9TZ:.\-]*\] //' | sort -u)
    # Consume canaries silently (same as new-errors branch).
    _UNFIXED_CANARY=$(printf '%s\n' "$UNFIXED_RAW" | grep -E "$_CANARY_RE" || true)
    if [ -n "$_UNFIXED_CANARY" ]; then
      while IFS= read -r line; do
        cid=$(printf '%s' "$line" | grep -oE 'CANARY-[a-zA-Z0-9-]+' | head -1 | sed 's/^CANARY-//')
        [ -n "$cid" ] && echo "$cid|consumed-by-stop|$(date +%s)" >> "$PROJECT/tmp/hme-canary-consumed.txt" 2>/dev/null  # silent-ok: optional fallback path.
      done <<< "$_UNFIXED_CANARY"
    fi
    _UNFIXED_NO_CANARY=$(printf '%s\n' "$UNFIXED_RAW" | grep -vE "$_CANARY_RE" | grep -vE "$_STATUS_LINE_RE" || true)
    # Same source-tag + severity-axis classification as the new-errors
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
        '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":("[ALERT] LIFESAVER -- UNADDRESSED ERRORS FROM PREVIOUS TURN:\n" + $errors + (if $self != "" then "\n\n[self-origin:\n" + $self + "]" else "" end) + "\n\nFix them now. Acknowledging without fixing is a CRITICAL VIOLATION.")},"decision":"block","reason":"LIFESAVER: UNADDRESSED ERRORS FROM PREVIOUS TURN"}'
      _stderr_verdict "FAIL: lifesaver prior-turn"
      exit 0
    elif [ -n "$UNFIXED_SELF" ]; then
      # Self-origin observations only -- surface as additionalContext, don't block.
      jq -n \
        --arg self "$UNFIXED_SELF" \
        '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":("[hme self-health, prior turn] " + $self + "\n(observability only -- supervisor/operator concern, not agent action)")}}'
      _stderr_verdict "PASS: lifesaver prior-turn self-only"
      exit 0
    fi
    # Canary-only or empty after filter -- silent pass; watermark already advanced.
    _stderr_verdict "PASS: lifesaver prior-turn canary-only"
  fi
fi
