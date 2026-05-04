# Consolidated detector run
# All 6 stop-side detectors (poll_count / idle_after_bg / psycho_stop /
# ack_skip / abandon_check / stop_work) run in ONE python3 invocation via
# run_all.py -- parse the transcript once, share the cache, amortize the
# ~400ms python-interpreter startup that used to fire per detector.
# Previous p95 was 5.5s (n=78); consolidated is ~170ms on small
# transcripts, grows sub-linearly with transcript size.
INPUT="${INPUT:?detectors.sh requires INPUT from dispatcher (Stop payload)}"
TRANSCRIPT_PATH=$(_safe_jq "$INPUT" '.transcript_path' '')
# Detector init / parse-case / persist-block all generated from registry.json
# via emit_detectors_sh.py. Adding a detector = one entry in registry.json;
# no manual bash sync needed (the silent-disable bug class is gone).
eval "$(python3 "${PROJECT_ROOT:-${CLAUDE_PROJECT_DIR}}/tools/HME/scripts/detectors/emit_detectors_sh.py" 2>/dev/null)"
if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  # run_all.py emits `name=verdict`; stderr bridged to hme-errors.log so a crash can't silently disable detectors.
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
  while IFS='=' read -r _k _v; do _detector_parse_case "$_k" "$_v"; done <<< "$_RUN_ALL_OUT"
  # Sanity: poll_count must be numeric for the -ge test below.
  [[ "$POLL_COUNT" =~ ^[0-9]+$ ]] || POLL_COUNT=0
fi

# Persist verdicts: each stage runs in its own subshell so consumers
# (anti_patterns.sh, work_checks.sh) read this file rather than inherit env.
_DETECTOR_VERDICTS_FILE="${PROJECT_ROOT:-${CLAUDE_PROJECT_DIR}}/runtime/hme/stop-detector-verdicts.env"
mkdir -p "$(dirname "$_DETECTOR_VERDICTS_FILE")" 2>/dev/null
_detector_emit_persist > "$_DETECTOR_VERDICTS_FILE"

# senior_consult_debt: informational stderr reminder (not a hard block).
# Elevate to hard block downstream of detectors.sh if recurring.
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

# ignore_and_trample hard block. Block JSON -> stdout (shell_policy.js parses).
if [ "$IGNORE_AND_TRAMPLE" = "ignore-and-trample" ]; then
  cat <<'_IT_MSG'
{"decision": "block", "reason": "IGNORE-AND-TRAMPLE VIOLATION: A user message arrived mid-response (system-reminder embedded in a tool_result) but your reply did not acknowledge it immediately. Required openers: \"Acknowledged <one-word> input\" (then either address it now, or -- only if current work doesn't conflict -- say \"Wrapping up this quickly first.\"). Resume now: acknowledge the user's message in your next text, then either address it or wrap up the current work coherently."}
_IT_MSG
fi
