#!/usr/bin/env bash
# Policy-enabled helper for bash gates that have a JS-policy counterpart in
# tools/HME/policies/builtin/. Reads the same three-scope config as
# i/policies (project/local/global) and returns the same enable/disable
# answer — so `i/policies disable <name>` works uniformly across both
# the JS layer (live in proxy-up mode) and the bash layer (live in
# proxy-down direct-mode).
#
# Closes the duplication wart documented in policies/README.md: before
# this helper, `i/policies disable X` only disabled the JS path; the
# bash gate still fired. Now both respect the same config.
#
# Usage:
#   source tools/HME/hooks/helpers/_policy_enabled.sh
#   _policy_enabled block-curl-pipe-sh || return 0   # skip the gate when disabled
#
# Returns: 0 (enabled — caller should run the gate) or 1 (disabled —
# caller should skip). When neither list mentions the policy, returns 0
# (default-enabled per the registered policy's defaultEnabled flag,
# which for every migrated bash gate is true).
#
# Implementation: pure jq, no node startup. ~5ms cold, ~1ms warm. Three-
# scope lookup matches policies/config.js semantics: disable wins over
# enable across all scopes; first-defined-wins within a scope.

_policy_enabled() {
  local name="$1"
  [ -z "$name" ] && return 0
  command -v jq >/dev/null 2>&1 || return 0  # no jq → can't read config → assume enabled

  local project_root="${PROJECT_ROOT:-/home/jah/Polychron}"
  local files=(
    "$project_root/.hme/policies.local.json"
    "$project_root/.hme/policies.json"
    "${HOME}/.hme/policies.json"
  )

  # Disabled wins over enabled (matches policies/config.js).
  local f
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    if jq -e --arg n "$name" '(.disabled // []) | index($n)' "$f" >/dev/null 2>&1; then
      return 1
    fi
  done
  # No disable found → enabled (defaultEnabled=true is the convention for
  # every bash-gate-with-JS-counterpart we currently have).
  return 0
}
