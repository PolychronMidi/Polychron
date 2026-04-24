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
  # Surfaced via the new terse-verdict trap — user saw `fail=2` at 20ms.
  python3 "$_DETECTORS_DIR/context_meter.py" "$_CTX_TRANSCRIPT" "$_CTX_OUT" 2>/dev/null || true
fi
