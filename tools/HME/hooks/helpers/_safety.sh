# Shared safety preamble for all HME hooks.
# Source this at the top of every hook script.
# Logic lives in helpers/safety/*.sh; this dispatcher sources them in order.
set -euo pipefail

_HME_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_HME_SAFETY_DIR="${_HME_HELPERS_DIR}/safety"

# 1) Project root + .env + adaptive config
source "${_HME_SAFETY_DIR}/project_root.sh"

# 2) Unified signal bus. Every hook that emits events calls _signal_emit;
# shellcheck disable=SC1091
source "${_HME_HELPERS_DIR}/_signals.sh"
source "${_HME_HELPERS_DIR}/hook_ledger.sh"
source "${_HME_HELPERS_DIR}/service_registry.sh"
source "${_HME_HELPERS_DIR}/bg.sh"

_hme_command_name() {
  local cmd="${1:-}"
  [ -n "$cmd" ] || return 0
  PROJECT_ROOT="${PROJECT_ROOT:-}" python3 - "$cmd" <<'PY' 2>/dev/null || true
import os, shlex, sys
cmd = (sys.argv[1] or '').strip().splitlines()[0]
tools = {'review', 'learn', 'trace', 'evolve', 'status', 'hme', 'audit', 'why', 'policies'}
try:
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=';&|()')
    lex.whitespace_split = True
    tokens = list(lex)
except Exception:
    tokens = cmd.split()
for i, tok in enumerate(tokens):
    if tok in {';', '&', '|', '||', '&&', '(', ')'}:
        continue
    base = os.path.basename(tok)
    if base in tools and (tok.startswith('i/') or tok.startswith('./tools/HME/i/') or '/i/' in tok):
        print(f'i/{base}')
        break
    if tok.endswith('tools/HME/scripts/hme-cli.js') or tok == 'tools/HME/scripts/hme-cli.js':
        tool = tokens[i + 1] if i + 1 < len(tokens) else ''
        if tool in tools:
            print(f'i/{tool}')
            break
PY
}

# 3) Capture hook identity from caller at TOP LEVEL so BASH_SOURCE[1] refers
# to the hook script that sourced _safety.sh (not a sub-helper).
_HME_HOOK_START_NS="$(date +%s%N)"
_HME_HOOK_NAME="$(basename "${BASH_SOURCE[2]:-${BASH_SOURCE[1]:-unknown}}" .sh)"
_HME_HOOK_EVENT="${HME_HOOK_EVENT:-hook}"
_HME_HOOK_EXIT_CODE=0
_HME_HOOK_VERDICT=""

# 4) Tunable constants -- set before any sub-file references them.
# Keep bootstrap hot path shell-only: service_registry.py startup was a frequent
# >1s latency source in PreToolUse. The worker default is stable and env may
# override it; deeper service metadata remains available through _hme_service_*.
_HME_HTTP_PORT="${HME_WORKER_PORT:-9098}"
_HME_SRC_PATTERN='/Polychron/(src|tools|scripts|doc|lab)/'
_HME_EDIT_PATTERN='/Polychron/(src|tools|scripts|doc|lab)/'

# 5) Function library
source "${_HME_SAFETY_DIR}/latency.sh"
source "${_HME_SAFETY_DIR}/misc_safe.sh"
source "${_HME_SAFETY_DIR}/curl.sh"
source "${_HME_SAFETY_DIR}/emitters.sh"
source "${_HME_SAFETY_DIR}/http.sh"

# 6) Install EXIT trap AFTER _hme_exit_combined is defined (latency.sh).
trap _hme_exit_combined EXIT
