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

for _part in hme_dispatch cwd_rewrite gates blackbox_guards reader_guards polling_redirects snapshot_gate pipeline_antiwait failfast polling_counter; do
  source "${SCRIPT_DIR}/bash/${_part}.sh"
done
exit 0
