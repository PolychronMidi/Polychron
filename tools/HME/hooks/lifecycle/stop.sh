#!/usr/bin/env bash
# HME Stop: enforce implementation completeness + drive autonomous Evolver loop.
# Antipattern detection logic lives in tools/HME/scripts/detectors/*.py — each
# detector is a standalone script that reads a transcript path from argv and
# prints a status token. This dispatcher sources sub-scripts in order; each
# may `exit 0` after emitting a block decision.
_STOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_HME_HELPERS_DIR="${_STOP_DIR}/../helpers"
source "${_HME_HELPERS_DIR}/_safety.sh"
INPUT=$(cat)

# Order is load-bearing: work_checks (auto-completeness inject + exhaust_check
# gate) runs BEFORE optional/diagnostic steps (holograph, post_hooks). Prior
# order ran completeness LAST — a crash in any earlier step silently killed
# the injector. Evidence: `$_AC_PROJECT` referenced in holograph.sh had never
# been defined anywhere; every stop.sh run crashed with "unbound variable"
# before reaching work_checks, and nobody noticed because the `fail=1` stderr
# emitted by the _safety.sh EXIT trap looks like every other routine failure.
#
# Each sub-file may `exit 0` to signal "chain-terminal block emitted" — that
# exit exits the whole shell (proper behavior — sub-file's block output is
# the entire hook response). Otherwise sub-file runs to completion and we
# proceed to the next part.
#
# Defence-in-depth: `set +u` around each source so a stray unbound-variable
# bug in one sub-file (like the _AC_PROJECT regression) no longer aborts the
# whole chain. Any non-zero exit from the source is logged to hme-errors.log
# so LIFESAVER surfaces the broken gate next turn — silent fail=1 is gone.
for _part in _preamble autocommit lifesaver evolver detectors anti_patterns nexus_audit work_checks holograph post_hooks; do
  # Defence against ALL chain-killing failure modes inherited from _safety.sh:
  #   set -u → unbound-var crash (the _AC_PROJECT regression that silenced
  #            auto-completeness for months)
  #   set -e → non-zero command aborts the whole shell mid-sub-file
  # A sub-file that INTENDS to terminate the chain still does so via
  # `exit 0` (shell-level exit bypasses all guards).
  #
  # Capture stderr into a temp file so a crashing sub-file's error message
  # is recorded in hme-errors.log — the previous `rc=N` alone said "X
  # broke" without telling us WHY. A silent bash error (like unbound
  # $_AC_PROJECT) took 40+ min to trace because the actual message was
  # lost to a /dev/null redirect. Tee the stderr so it both reaches
  # Claude Code's hook stderr AND survives in _stderr_capture for us.
  _stderr_capture=$(mktemp 2>/dev/null || echo "/tmp/stop-${_part}-stderr.$$")
  set +u +e
  source "${_STOP_DIR}/stop/${_part}.sh" 2> >(tee -a "$_stderr_capture" >&2)
  _rc=$?
  set -u -e
  if [ "$_rc" -ne 0 ]; then
    _ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
    _log="${PROJECT_ROOT:-/tmp}/log/hme-errors.log"
    mkdir -p "$(dirname "$_log")" 2>/dev/null
    # Capture last 2 lines of stderr — usually the actual error message
    # plus any bash frame info. More than that would spam LIFESAVER.
    _stderr_tail=$(tail -2 "$_stderr_capture" 2>/dev/null | tr '\n' ' | ' | cut -c1-300)
    printf '[%s] [stop.sh] sub-file %s exited rc=%d — stderr-tail: %s\n' \
      "$_ts" "$_part" "$_rc" "${_stderr_tail:-(empty)}" >> "$_log" 2>/dev/null
  fi
  rm -f "$_stderr_capture" 2>/dev/null
done
