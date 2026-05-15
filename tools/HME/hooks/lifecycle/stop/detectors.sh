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
eval "$(python3 "${PROJECT_ROOT:-${CLAUDE_PROJECT_DIR}}/tools/HME/scripts/detectors/emit_detectors_sh.py" 2>/dev/null)"  # silent-ok: optional fallback path.
if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  _DET_PY_ERR=$(mktemp 2>/dev/null || echo "/tmp/_det_py_err_$$")  # silent-ok: optional fallback path.
  _RUN_ALL_OUT=$(timeout 3 python3 "$_DETECTORS_DIR/run_all.py" "$TRANSCRIPT_PATH" 2>"$_DET_PY_ERR" || true)
  if [ -s "$_DET_PY_ERR" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
    _DET_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    while IFS= read -r _det_line; do
      [ -n "$_det_line" ] && echo "[$_DET_TS] [stop_detectors:run_all] detector stderr: $_det_line" \
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
