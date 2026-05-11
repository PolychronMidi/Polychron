#!/usr/bin/env bash
# Bash-side mirror of i/policies enable/disable lookup so JS and bash gates
# both honor `i/policies disable <name>`. Three-scope (project/local/global),
# disable-wins, default-enabled. Pure jq (~1ms warm).
# Usage: _policy_enabled <name> || return 0   # skip gate when disabled.

_policy_enabled() {
  local name="$1"
  [ -z "$name" ] && return 0
  command -v jq >/dev/null 2>&1 || return 0  # no jq -> can't read config -> assume enabled

  local project_root="${PROJECT_ROOT:-${CLAUDE_PROJECT_DIR:-}}"
  local files=(
    "$project_root/config/policies.local.json"
    "$project_root/config/policies.json"
  )

  # Disabled wins over enabled (matches policies/config.js).
  local f
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    if jq -e --arg n "$name" '(.disabled // []) | index($n)' "$f" >/dev/null 2>&1; then
      return 1
    fi
  done
  # No disable found -> enabled (defaultEnabled=true is the convention for
  # every bash-gate-with-JS-counterpart we currently have).
  return 0
}
