source "${_HME_HELPERS_DIR:-${PROJECT_ROOT}/tools/HME/hooks/helpers}/_hooks_bootstrap.sh"
# Consolidated detector run
# All 6 stop-side detectors (poll_count / idle_after_bg / psycho_stop /
# ack_skip / abandon_check / stop_work) run in ONE python3 invocation via
# run_all.py -- parse the transcript once, share the cache, amortize the
# ~400ms python-interpreter startup that used to fire per detector.
# Previous p95 was 5.5s (n=78); consolidated is ~170ms on small
# transcripts, grows sub-linearly with transcript size.
INPUT="${INPUT:?detectors.sh requires INPUT from dispatcher (Stop payload)}"
TRANSCRIPT_PATH=$(_safe_jq "$INPUT" '.transcript_path' '')
# Detector init / parse-case / persist-block all generated from registry.json.
# Mandatory stop checks must fail closed: if the generated detector shell glue or
# the detector runner fails, do not persist all-ok defaults and allow stopping.
_DET_ERR_DIR="${PROJECT_ROOT}/tools/HME/runtime"
mkdir -p "$_DET_ERR_DIR" 2>/dev/null
_DET_EMIT_ERR=$(mktemp "$_DET_ERR_DIR/det_emit_err.XXXXXX" 2>/dev/null || echo "$_DET_ERR_DIR/_det_emit_err_$$")  # silent-ok: optional fallback path.
_DET_EMIT_OUT=$(python3 "${PROJECT_ROOT}/tools/HME/scripts/detectors/emit_detectors_sh.py" 2>"$_DET_EMIT_ERR")
_DET_EMIT_STATUS=$?
if [ "$_DET_EMIT_STATUS" -ne 0 ] || [ -z "$_DET_EMIT_OUT" ]; then
  cat "$_DET_EMIT_ERR" >&2 2>/dev/null
  rm -f "$_DET_EMIT_ERR" 2>/dev/null
  echo "stop_detectors: detector shell generation failed (status=$_DET_EMIT_STATUS)" >&2
  return 1 2>/dev/null || exit 1
fi
rm -f "$_DET_EMIT_ERR" 2>/dev/null
eval "$_DET_EMIT_OUT"
if ! type _detector_parse_case >/dev/null 2>&1 || ! type _detector_emit_persist >/dev/null 2>&1; then
  echo "stop_detectors: generated detector helpers missing" >&2
  return 1 2>/dev/null || exit 1
fi
if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  _DET_PY_ERR=$(mktemp "$_DET_ERR_DIR/det_py_err.XXXXXX" 2>/dev/null || echo "$_DET_ERR_DIR/_det_py_err_$$")  # silent-ok: optional fallback path.
  _RUN_ALL_OUT=$(timeout "${HME_STOP_DETECTORS_TIMEOUT_SEC:-12}" python3 "$_DETECTORS_DIR/run_all.py" "$TRANSCRIPT_PATH" 2>"$_DET_PY_ERR")
  _RUN_ALL_STATUS=$?
  if [ -s "$_DET_PY_ERR" ] && [ -n "${PROJECT_ROOT}" ] && [ -d "$PROJECT_ROOT/log" ]; then
    _DET_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    while IFS= read -r _det_line; do
      [ -n "$_det_line" ] && echo "[$_DET_TS] [stop_detectors:run_all] detector stderr: $_det_line" \
        >> "$PROJECT_ROOT/log/hme-errors.log"
    done < "$_DET_PY_ERR"
  fi
  if [ "$_RUN_ALL_STATUS" -ne 0 ]; then
    cat "$_DET_PY_ERR" >&2 2>/dev/null
    rm -f "$_DET_PY_ERR" 2>/dev/null
    echo "stop_detectors: run_all.py failed (status=$_RUN_ALL_STATUS)" >&2
    return 1 2>/dev/null || exit 1
  fi
  rm -f "$_DET_PY_ERR" 2>/dev/null
  while IFS='=' read -r _k _v; do _detector_parse_case "$_k" "$_v"; done <<< "$_RUN_ALL_OUT"
  # Sanity: poll_count must be numeric for the -ge test below.
  [[ "$POLL_COUNT" =~ ^[0-9]+$ ]] || POLL_COUNT=0
fi

# Persist verdicts: each stage runs in its own subshell so consumers
# (anti_patterns.sh, work_checks.sh) read this file rather than inherit env.
_DETECTOR_VERDICTS_FILE="${PROJECT_ROOT}/tools/HME/runtime/stop-detector-verdicts.env"
mkdir -p "$(dirname "$_DETECTOR_VERDICTS_FILE")" 2>/dev/null
_detector_emit_persist > "$_DETECTOR_VERDICTS_FILE"
