# stop.sh preamble: detectors dir + context meter.
# INPUT, PROJECT_ROOT, _HME_HELPERS_DIR, _STOP_DIR are inherited from
# the dispatcher (stop.sh) which sourced _safety.sh and captured stdin first.
# (`_stderr_verdict` / auto-summary-on-EXIT provided by _safety.sh.)

# Fail-loud self-assignment: requires the dispatcher to have set INPUT
INPUT="${INPUT:?_preamble.sh requires INPUT from dispatcher (Claude Code Stop payload via stdin)}"

# Resolve detectors via $PROJECT_ROOT (set by .env/_safety.sh) so the
# running copy always tracks git HEAD, regardless of $BASH_SOURCE.
_DETECTORS_DIR="${PROJECT_ROOT}/tools/HME/scripts/detectors"

# Context meter: merge token counts into existing statusLine data
_CTX_OUT="$PROJECT_ROOT/tools/HME/runtime/claude-context.json"
_CTX_TRANSCRIPT=$(_safe_jq "$INPUT" '.transcript_path' '')
if [[ -n "$_CTX_TRANSCRIPT" && -f "$_CTX_TRANSCRIPT" ]]; then
  # `|| true` is load-bearing: under set -e, a python crash here (e.g.
  _PRE_PY_ERR=$(mktemp "$PROJECT_ROOT/tools/HME/runtime/_pre_py_err_XXXXXX" 2>/dev/null || echo "$PROJECT_ROOT/tools/HME/runtime/_pre_py_err_$$")  # silent-ok: optional fallback path.
  python3 "$_DETECTORS_DIR/context_meter.py" "$_CTX_TRANSCRIPT" "$_CTX_OUT" 2>"$_PRE_PY_ERR" || true
  if [ -s "$_PRE_PY_ERR" ] && [ -n "${PROJECT_ROOT}" ] && [ -d "$PROJECT_ROOT/log" ]; then
    _PRE_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    while IFS= read -r _pre_line; do
      [ -n "$_pre_line" ] && echo "[$_PRE_TS] [stop_preamble:context_meter] python3 failed: $_pre_line" \
        >> "$PROJECT_ROOT/log/hme-errors.log"
    done < "$_PRE_PY_ERR"
  fi
  rm -f "$_PRE_PY_ERR" 2>/dev/null
fi
