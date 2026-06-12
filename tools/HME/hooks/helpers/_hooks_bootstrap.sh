# Single source-of-truth bootstrap for HME hook scripts. Every hook should
# `source` this file FIRST; it loads every helper in the correct order.

_HBOOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# safety dispatcher sources project_root, signals, ledger, registry, bg, etc.
source "${_HBOOT_DIR}/_safety.sh"
source "${_HBOOT_DIR}/_policy_enabled.sh"
source "${_HBOOT_DIR}/_onboarding.sh"
source "${_HBOOT_DIR}/_nexus.sh"
source "${_HBOOT_DIR}/_check_errors_inline.sh"
source "${_HBOOT_DIR}/_tab_helpers.sh"
source "${_HBOOT_DIR}/cwd_guard.sh"

# Decision-response helpers (item #10): canonical JSON envelopes.
_hook_decision_deny() {
  local reason="$1"
  local include_system_message="${2:-0}"
  if [ "$include_system_message" = "1" ]; then
    jq -n --arg r "$reason" '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$r},"systemMessage":$r}'
  else
    jq -n --arg r "$reason" '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$r}}'
  fi
}

_hook_decision_allow() {
  local reason="${1:-}"
  if [ -z "$reason" ]; then
    jq -n '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
  else
    jq -n --arg r "$reason" '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":$r}}'
  fi
}

_hook_decision_rewrite_bash() {
  local new_cmd="$1"
  local reason="${2:-rewritten by hook}"
  jq -n --arg c "$new_cmd" --arg r "$reason" '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":$r,"updatedInput":{"command":$c}}}'
}
