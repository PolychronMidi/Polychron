#!/usr/bin/env bash
# Shared safety preamble for all HME hooks.
# Source this at the top of every hook script.
# Logic lives in helpers/safety/*.sh; this dispatcher sources them in order.
set -euo pipefail

_HME_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_HME_SAFETY_DIR="${_HME_HELPERS_DIR}/safety"

# 1) Project root + .env + adaptive config
source "${_HME_SAFETY_DIR}/project_root.sh"

# 2) Unified signal bus. Every hook that emits events calls _signal_emit;
# status + diagnostics tail the bus instead of reconstructing state from
# multiple tmp/ files.
# shellcheck disable=SC1091
source "${_HME_HELPERS_DIR}/_signals.sh"

# 3) Capture hook identity from caller at TOP LEVEL so BASH_SOURCE[1] refers
# to the hook script that sourced _safety.sh (not a sub-helper).
_HME_HOOK_START_NS="$(date +%s%N)"
_HME_HOOK_NAME="$(basename "${BASH_SOURCE[1]:-unknown}" .sh)"
_HME_HOOK_VERDICT=""

# 4) Tunable constants — set before any sub-file references them.
_HME_HTTP_PORT=9098
_HME_SRC_PATTERN='/Polychron/(src|tools|scripts|doc|lab)/'
_HME_EDIT_PATTERN='/Polychron/(src|tools|scripts|doc|lab)/'

# 5) Function library
# misc_safe must load before curl.sh (provides _safe_int) and any caller
# of _safe_jq / _safe_int / _lifesaver_bg / _safe_py3.
source "${_HME_SAFETY_DIR}/latency.sh"
source "${_HME_SAFETY_DIR}/misc_safe.sh"
source "${_HME_SAFETY_DIR}/curl.sh"
source "${_HME_SAFETY_DIR}/emitters.sh"
source "${_HME_SAFETY_DIR}/streak.sh"
source "${_HME_SAFETY_DIR}/http_shim.sh"

# 6) Install EXIT trap AFTER _hme_exit_combined is defined (latency.sh).
trap _hme_exit_combined EXIT
