#!/usr/bin/env bash
# Logic lives in pretooluse/bash/*.sh; this dispatcher sources them in order.
# Each sub-script may `exit 0` / `exit 2` after emitting a decision.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_HME_HELPERS_DIR="${SCRIPT_DIR}/../helpers"
source "${_HME_HELPERS_DIR}/_safety.sh"
source "${_HME_HELPERS_DIR}/_onboarding.sh"
INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')

# Defense-in-depth: wrap each source in `set +u +e` so a stray unbound-var
for _part in hme_dispatch cwd_rewrite intent_rewrite gates blackbox_guards reader_guards verify_landed_block polling_redirects log_first kb_spam snapshot_gate pipeline_antiwait failfast polling_counter; do
  set +u +e
  source "${SCRIPT_DIR}/bash/${_part}.sh"
  _rc=$?
  set -u -e
  if [ "$_rc" -ne 0 ] && [ "$_rc" -ne 2 ]; then
    _ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
    _log="${PROJECT_ROOT:-/tmp}/log/hme-errors.log"
    mkdir -p "$(dirname "$_log")" 2>/dev/null
    printf '[%s] [pretooluse_bash.sh] sub-file %s exited rc=%d -- downstream gates may have been skipped; investigate\n' \
      "$_ts" "$_part" "$_rc" >> "$_log" 2>/dev/null  # silent-ok: optional fallback path.
  fi
done
exit 0
