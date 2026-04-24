#!/usr/bin/env bash
# HME PreToolUse: Bash — block run.lock deletion + suggest HME alternatives + anti-wait injection.
# Logic lives in pretooluse/bash/*.sh; this dispatcher sources them in order.
# Each sub-script may `exit 0` / `exit 2` after emitting a decision.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_HME_HELPERS_DIR="${SCRIPT_DIR}/../helpers"
source "${_HME_HELPERS_DIR}/_safety.sh"
source "${_HME_HELPERS_DIR}/_onboarding.sh"
INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')

# Defense-in-depth: wrap each source in `set +u +e` so a stray unbound-var
# or non-zero-return in one sub-file can't kill the whole chain silently.
# Sub-files that intend to terminate the chain still use explicit `exit N`.
# Mirrors the same guard in lifecycle/stop.sh — see the auto-completeness
# post-mortem (Apr 2026) for why this class of silent failure must not
# recur: one undefined var caused months of invisible hook breakage.
for _part in hme_dispatch cwd_rewrite gates blackbox_guards reader_guards polling_redirects snapshot_gate pipeline_antiwait failfast polling_counter; do
  set +u +e
  source "${SCRIPT_DIR}/bash/${_part}.sh"
  _rc=$?
  set -u -e
  if [ "$_rc" -ne 0 ] && [ "$_rc" -ne 2 ]; then
    _ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
    _log="${PROJECT_ROOT:-/tmp}/log/hme-errors.log"
    mkdir -p "$(dirname "$_log")" 2>/dev/null
    printf '[%s] [pretooluse_bash.sh] sub-file %s exited rc=%d — downstream gates may have been skipped; investigate\n' \
      "$_ts" "$_part" "$_rc" >> "$_log" 2>/dev/null
  fi
done
exit 0
