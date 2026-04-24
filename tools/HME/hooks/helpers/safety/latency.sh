# H3: Hook latency telemetry — each hook self-logs its wall time to
# log/hme-hook-latency.jsonl on exit via a trap. The HookLatencyVerifier
# reads this log and flags hooks that exceed 500ms p95.
# _HME_HOOK_START_NS / _HME_HOOK_NAME / _HME_HOOK_VERDICT are captured
# by the dispatcher (_safety.sh) BEFORE this file is sourced, so
# BASH_SOURCE[1] resolves to the hook script — not this sub-helper.

_stderr_verdict() {
  # Set the one-line exit summary. Last call wins. Any hook can use this.
  _HME_HOOK_VERDICT="$1"
}

_hme_log_hook_latency() {
  # PROJECT_ROOT must come from .env (sourced above). Never silently fall back
  # to $(pwd) / cwd — that spawns orphan log/ dirs under whatever directory the
  # tool happened to be running in.
  if [ -z "${PROJECT_ROOT:-}" ] || [ ! -d "$PROJECT_ROOT/src" ]; then
    return 0
  fi
  local log_file="$PROJECT_ROOT/log/hme-hook-latency.jsonl"
  mkdir -p "$(dirname "$log_file")" 2>/dev/null
  printf '{"hook":"%s","duration_ms":%d,"ts":%s}\n' \
    "$_HME_HOOK_NAME" "$1" "$(date +%s)" >> "$log_file" 2>/dev/null
  # Rotate when log exceeds 10000 lines — keeps last 5000
  local size
  size=$(wc -l < "$log_file" 2>/dev/null || echo 0)
  if [ "$size" -gt 10000 ]; then
    tail -5000 "$log_file" > "${log_file}.tmp" 2>/dev/null \
      && mv "${log_file}.tmp" "$log_file" 2>/dev/null
  fi
}

# Composite EXIT trap. Captures the ORIGINAL exit code before any helper
# runs (latency log or stderr emission), computes elapsed once, then
# dispatches. Either the explicit verdict set by `_stderr_verdict` wins,
# or a MINIMAL default fires so the agent-side forwarded notification
# (Stop hook feedback: [cmd]: <stderr>) carries a short token instead
# of "No stderr output" filler — but without adding character overhead
# beyond the empty placeholder. Claude Code already shows the hook
# name in the notification header, so we omit it here; "ok" / "fail=<N>"
# is the smallest signal set that still distinguishes clean from broken.
_hme_exit_combined() {
  local code=$?
  local end_ns dur_ms
  end_ns="$(date +%s%N)"
  dur_ms=$(( (end_ns - _HME_HOOK_START_NS) / 1000000 ))
  _hme_log_hook_latency "$dur_ms"
  if [ -n "$_HME_HOOK_VERDICT" ]; then
    echo "$_HME_HOOK_VERDICT" >&2
  elif [ "$code" -ne 0 ]; then
    echo "fail=$code" >&2
  else
    echo "ok" >&2
  fi
  return $code
}
