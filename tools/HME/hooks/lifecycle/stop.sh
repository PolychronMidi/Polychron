#!/usr/bin/env bash
# HME Stop: enforce implementation completeness + drive autonomous Evolver loop.
# Antipattern detection logic lives in tools/HME/scripts/detectors/*.py — each
# detector is a standalone script that reads a transcript path from argv and
# prints a status token. This dispatcher runs sub-scripts as POLICIES (see
# the explicit policy-evaluator semantics below) and aggregates their
# decisions deterministically.
_STOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_HME_HELPERS_DIR="${_STOP_DIR}/../helpers"
source "${_HME_HELPERS_DIR}/_safety.sh"
INPUT=$(cat)

# Shared env that downstream stages need. Previously _preamble.sh set these
# and they propagated via sourced scope — under subshell isolation we set
# them in the parent so subshells inherit.
_DETECTORS_DIR="${PROJECT_ROOT:-/home/jah/Polychron}/tools/HME/scripts/detectors"
export _DETECTORS_DIR INPUT _STOP_DIR _HME_HELPERS_DIR

# Clear stale detector-verdict file from a previous (possibly crashed) Stop.
# detectors.sh writes this; anti_patterns.sh + work_checks.sh source it.
_DETECTOR_VERDICTS_FILE="${PROJECT_ROOT:-/home/jah/Polychron}/tmp/hme-stop-detector-verdicts.env"
rm -f "$_DETECTOR_VERDICTS_FILE" 2>/dev/null

# Order is load-bearing.
#
# nexus_edit_check runs AT POSITION 2 (right after _preamble) so an
# unreviewed-edit block is emitted before any later sub-script can crash
# the chain. Prior order placed the EDIT gate at position 7 — verified
# bypass case: 22 EDITs present, chain finished in 117ms with no block,
# because some earlier sub-script `exit 0`'d the shell mid-flight.
#
# work_checks (auto-completeness inject + exhaust_check gate) runs BEFORE
# optional/diagnostic steps (holograph, post_hooks).
#
# Policy evaluator semantics (lifted from FailproofAI's hook chain):
#   - Each stage runs in a SUBSHELL, not via `source`. An `exit N` from a
#     sub-script exits the subshell only — the parent chain continues.
#     This structurally eliminates the bug class where a sub-script's
#     `exit 0` mid-flight terminated the whole chain (verified failure
#     mode: 117ms silent finish with 22 EDITs present, no block emitted).
#   - Each stage's stdout is captured separately. If it contains a block
#     decision (`{"decision":"block",...}`), the FIRST such decision wins.
#     Subsequent block decisions are still allowed to compute (their stage
#     may have side effects like autocommit), but only the first is emitted.
#   - The chain runs to completion regardless of decisions; this lets later
#     stages perform their side effects (autocommit, holograph snapshots,
#     post_hooks) even when an earlier stage produced a block.
#
# `set +u +e` around each subshell still defends against unbound-var/
# non-zero-exit crashes that don't `exit 0` on purpose. The combination
# of subshell isolation + per-part trace + stderr capture means any future
# silent failure has three independent diagnostic channels.
_STOP_TRACE_FILE="${PROJECT_ROOT:-/home/jah/Polychron}/tmp/hme-stop-chain.trace"
mkdir -p "$(dirname "$_STOP_TRACE_FILE")" 2>/dev/null
: > "$_STOP_TRACE_FILE"
_stop_trace() {
  local _ts; _ts=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
  printf '%s %s %s\n' "$_ts" "$1" "${2:-}" >> "$_STOP_TRACE_FILE" 2>/dev/null
}
_stop_trace "chain_start"

# First-block-wins buffer. Held until the chain completes, then emitted as
# stop.sh's stdout — Claude Code interprets that as the hook decision.
_BLOCK=""

for _part in _preamble nexus_edit_check autocommit lifesaver evolver detectors anti_patterns nexus_pending work_checks holograph post_hooks; do
  _stderr_capture=$(mktemp 2>/dev/null || echo "/tmp/stop-${_part}-stderr.$$")
  _stop_trace "enter" "$_part"
  set +u +e
  # Subshell isolation — `( source ... )` runs in a forked child shell.
  # `exit 0` from the sub-script exits the child, NOT the parent loop.
  _OUT=$( ( source "${_STOP_DIR}/stop/${_part}.sh" ) 2> >(tee -a "$_stderr_capture" >&2) )
  _rc=$?
  set -u -e
  _stop_trace "exit" "$_part rc=$_rc"

  # First block decision wins. Subsequent stages still run (side effects).
  if [ -z "$_BLOCK" ] && echo "$_OUT" | grep -q '"decision"[[:space:]]*:[[:space:]]*"block"'; then
    _BLOCK="$_OUT"
    _stop_trace "block_captured" "$_part"
  fi

  if [ "$_rc" -ne 0 ]; then
    _ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
    _log="${PROJECT_ROOT:-/tmp}/log/hme-errors.log"
    mkdir -p "$(dirname "$_log")" 2>/dev/null
    _stderr_tail=$(tail -2 "$_stderr_capture" 2>/dev/null | tr '\n' ' | ' | cut -c1-300)
    printf '[%s] [stop.sh] sub-file %s exited rc=%d — stderr-tail: %s\n' \
      "$_ts" "$_part" "$_rc" "${_stderr_tail:-(empty)}" >> "$_log" 2>/dev/null
  fi
  rm -f "$_stderr_capture" 2>/dev/null
done
_stop_trace "chain_end"

# Emit the consolidated decision. Empty stdout = allow.
[ -n "$_BLOCK" ] && printf '%s' "$_BLOCK"
