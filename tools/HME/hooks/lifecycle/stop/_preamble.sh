# stop.sh preamble: detectors dir + context meter.
# INPUT, PROJECT_ROOT, _HME_HELPERS_DIR, _STOP_DIR are inherited from
# the dispatcher (stop.sh) which sourced _safety.sh and captured stdin first.
# (`_stderr_verdict` / auto-summary-on-EXIT provided by _safety.sh.)

# Resolve detectors to the REPO, not relative to $BASH_SOURCE[0]. When
# Claude Code invokes this hook via the plugin-cache path, the relative
# ascent lands in ~/.claude/plugins/cache/.../scripts/detectors — which
# the install mechanism populates lazily (and bit-rots as new detectors
# land in the repo). Using $PROJECT_ROOT keeps the running copy in sync
# with git HEAD automatically.
_DETECTORS_DIR="${PROJECT_ROOT:-/home/jah/Polychron}/tools/HME/scripts/detectors"

# Context meter: merge token counts into existing statusLine data
# StatusLine writes authoritative used_pct/remaining_pct/size from the API.
# Stop hook only adds input_tokens/output_tokens from the transcript — never
# overwrites used_pct (that would replace real API data with a fabricated estimate).
_CTX_OUT="${HME_CTX_FILE:-/tmp/claude-context.json}"
_CTX_TRANSCRIPT=$(_safe_jq "$INPUT" '.transcript_path' '')
if [[ -n "$_CTX_TRANSCRIPT" && -f "$_CTX_TRANSCRIPT" ]]; then
  # `|| true` is load-bearing: under set -e, a python crash here (e.g.
  # context_meter.py ImportError under a stale module graph) would kill
  # stop.sh with exit 2, bypassing all the actual lifecycle checks below.
  # FAIL-LOUD: stderr now captured and bridged so a context_meter crash
  # surfaces to next-turn LIFESAVER instead of vanishing.
  _PRE_PY_ERR=$(mktemp 2>/dev/null || echo "/tmp/_pre_py_err_$$")
  python3 "$_DETECTORS_DIR/context_meter.py" "$_CTX_TRANSCRIPT" "$_CTX_OUT" 2>"$_PRE_PY_ERR" || true
  if [ -s "$_PRE_PY_ERR" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
    _PRE_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    while IFS= read -r _pre_line; do
      [ -n "$_pre_line" ] && echo "[$_PRE_TS] [stop_preamble:context_meter] python3 failed: $_pre_line" \
        >> "$PROJECT_ROOT/log/hme-errors.log"
    done < "$_PRE_PY_ERR"
  fi
  rm -f "$_PRE_PY_ERR" 2>/dev/null
fi
