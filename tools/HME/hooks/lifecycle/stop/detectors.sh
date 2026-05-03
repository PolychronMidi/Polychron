# Consolidated detector run
# All 6 stop-side detectors (poll_count / idle_after_bg / psycho_stop /
# ack_skip / abandon_check / stop_work) run in ONE python3 invocation via
# run_all.py -- parse the transcript once, share the cache, amortize the
# ~400ms python-interpreter startup that used to fire per detector.
# Previous p95 was 5.5s (n=78); consolidated is ~170ms on small
# transcripts, grows sub-linearly with transcript size.
INPUT="${INPUT:?detectors.sh requires INPUT from dispatcher (Stop payload)}"
TRANSCRIPT_PATH=$(_safe_jq "$INPUT" '.transcript_path' '')
POLL_COUNT=0
IDLE_AFTER_BG=ok
PSYCHO_STOP=ok
ACK_SKIP=ok
ABANDON_CHECK=ok
STOP_WORK=ok
FABRICATION_CHECK=ok
EARLY_STOP=ok
EXHAUST_CHECK=ok
SCOPE_ESCAPE=ok
SENIOR_CONSULT_DEBT=ok
IGNORE_AND_TRAMPLE=ok
PHANTOM_CAPABILITY=ok
ADVISOR_DOCTRINE=ok
SUMMARY_FORMAT=ok
LIVE_PROBE=ok
PHASE_GATE=ok
PILE_ON=ok
CLAIM_WITHOUT_EVIDENCE=ok
FIX_WITHOUT_INVESTIGATION=ok
COMMENT_BLOAT=ok
if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  # run_all.py prints one `name=verdict` line per detector. Parse into bash vars.
  # If run_all crashes we fall back to defaults above (equivalent to old
  # `|| echo ok` per-detector fallbacks).
  # FAIL-LOUD: stderr captured + bridged. A run_all crash silently
  # disabled all 9 stop-side detectors -- psycho_stop, exhaust_check,
  # fabrication_check, etc. -- letting the agent stop on broken work.
  _DET_PY_ERR=$(mktemp 2>/dev/null || echo "/tmp/_det_py_err_$$")
  _RUN_ALL_OUT=$(timeout 3 python3 "$_DETECTORS_DIR/run_all.py" "$TRANSCRIPT_PATH" 2>"$_DET_PY_ERR" || true)
  if [ -s "$_DET_PY_ERR" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
    _DET_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    while IFS= read -r _det_line; do
      [ -n "$_det_line" ] && echo "[$_DET_TS] [stop_detectors:run_all] python3 failed (all 9 detectors fail OPEN): $_det_line" \
        >> "$PROJECT_ROOT/log/hme-errors.log"
    done < "$_DET_PY_ERR"
  fi
  rm -f "$_DET_PY_ERR" 2>/dev/null
  while IFS='=' read -r _k _v; do
    case "$_k" in
      poll_count)    POLL_COUNT="$_v" ;;
      idle_after_bg) IDLE_AFTER_BG="$_v" ;;
      psycho_stop)   PSYCHO_STOP="$_v" ;;
      ack_skip)      ACK_SKIP="$_v" ;;
      abandon_check) ABANDON_CHECK="$_v" ;;
      stop_work)     STOP_WORK="$_v" ;;
      fabrication_check) FABRICATION_CHECK="$_v" ;;
      early_stop)    EARLY_STOP="$_v" ;;
      exhaust_check) EXHAUST_CHECK="$_v" ;;
      scope_escape)  SCOPE_ESCAPE="$_v" ;;
      senior_consult_debt) SENIOR_CONSULT_DEBT="$_v" ;;
      ignore_and_trample) IGNORE_AND_TRAMPLE="$_v" ;;
      phantom_capability) PHANTOM_CAPABILITY="$_v" ;;
      advisor_doctrine) ADVISOR_DOCTRINE="$_v" ;;
      summary_format) SUMMARY_FORMAT="$_v" ;;
      live_probe) LIVE_PROBE="$_v" ;;
      phase_gate) PHASE_GATE="$_v" ;;
      pile_on) PILE_ON="$_v" ;;
      claim_without_evidence) CLAIM_WITHOUT_EVIDENCE="$_v" ;;
      fix_without_investigation) FIX_WITHOUT_INVESTIGATION="$_v" ;;
    esac
  done <<< "$_RUN_ALL_OUT"
  # Sanity: poll_count must be numeric for the -ge test below.
  [[ "$POLL_COUNT" =~ ^[0-9]+$ ]] || POLL_COUNT=0
fi

# Persist verdicts for downstream consumers (anti_patterns.sh, work_checks.sh).
# The chain runs each stage in a subshell now, so consumers can no longer
# rely on inherited bash variables -- they source this file at the top.
_DETECTOR_VERDICTS_FILE="${PROJECT_ROOT:-/home/jah/Polychron}/tmp/hme-stop-detector-verdicts.env"
mkdir -p "$(dirname "$_DETECTOR_VERDICTS_FILE")" 2>/dev/null
{
  echo "POLL_COUNT=$POLL_COUNT"
  echo "IDLE_AFTER_BG=$IDLE_AFTER_BG"
  echo "PSYCHO_STOP=$PSYCHO_STOP"
  echo "ACK_SKIP=$ACK_SKIP"
  echo "ABANDON_CHECK=$ABANDON_CHECK"
  echo "STOP_WORK=$STOP_WORK"
  echo "FABRICATION_CHECK=$FABRICATION_CHECK"
  echo "EARLY_STOP=$EARLY_STOP"
  echo "EXHAUST_CHECK=$EXHAUST_CHECK"
  echo "SCOPE_ESCAPE=$SCOPE_ESCAPE"
  echo "SENIOR_CONSULT_DEBT=$SENIOR_CONSULT_DEBT"
  echo "IGNORE_AND_TRAMPLE=$IGNORE_AND_TRAMPLE"
  echo "PHANTOM_CAPABILITY=$PHANTOM_CAPABILITY"
  echo "ADVISOR_DOCTRINE=$ADVISOR_DOCTRINE"
  echo "SUMMARY_FORMAT=$SUMMARY_FORMAT"
  echo "LIVE_PROBE=$LIVE_PROBE"
  echo "PHASE_GATE=$PHASE_GATE"
  echo "PILE_ON=$PILE_ON"
  echo "CLAIM_WITHOUT_EVIDENCE=$CLAIM_WITHOUT_EVIDENCE"
  echo "FIX_WITHOUT_INVESTIGATION=$FIX_WITHOUT_INVESTIGATION"
} > "$_DETECTOR_VERDICTS_FILE"

# senior_consult_debt -- informational notice (NOT a hard block on first
# fire, per the buddy paradigm's gradual-tightening discipline). When
# the turn touched buddy-paradigm design-space files without an
# i/consult invocation, surface a stderr reminder so the operator and
# the agent both see the gap. If this fires repeatedly across sessions
# the verdict can be elevated to a hard block in stop chain hooks
# downstream of detectors.sh.
if [ "$SENIOR_CONSULT_DEBT" = "consult-debt" ]; then
  echo "[senior_consult_debt] design-space changes shipped without "\
"consulting the buddy. Checkpoint via i/consult OR explicitly note "\
"why solo was right. (Currently informational -- see "\
"BUDDY_SYSTEM.md wisdom section.)" >&2
elif [ "$SENIOR_CONSULT_DEBT" = "consult-thin" ]; then
  echo "[senior_consult_debt] consult invoked but produced zero "\
"crystallized KB entries -- either the question was thin or the senior "\
"saw nothing worth crystallizing. Watch for a chronic pattern (see "\
"BUDDY_SYSTEM.md Section C -- Goodhart-bait risk)." >&2
fi

# ignore_and_trample -- hard block. The user sent a new message
# mid-response and the agent's reply did not open with an
# acknowledgment ("Acknowledged <one-word> input" or "Wrapping up
# this quickly first."). Continuing prior work without acknowledging
# is the exact "Sorry -- you sent the new message and I just kept
# going" failure mode this detector exists to prevent.
#
# Block JSON goes to STDOUT (not stderr) -- the stop_chain JS evaluator
# (tools/HME/proxy/stop_chain/shell_policy.js:defaultParseDecision)
# parses stdout for `{"decision":"block",...}`. No exit 2 needed; the
# chain's orchestrator handles deny propagation.
if [ "$IGNORE_AND_TRAMPLE" = "ignore-and-trample" ]; then
  cat <<'_IT_MSG'
{"decision": "block", "reason": "IGNORE-AND-TRAMPLE VIOLATION: A user message arrived mid-response (system-reminder embedded in a tool_result) but your reply did not acknowledge it immediately. Required openers: \"Acknowledged <one-word> input\" (then either address it now, or -- only if current work doesn't conflict -- say \"Wrapping up this quickly first.\"). Resume now: acknowledge the user's message in your next text, then either address it or wrap up the current work coherently."}
_IT_MSG
fi
