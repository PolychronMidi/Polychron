#!/usr/bin/env bash
# HME onboarding shell helpers — thin bridge to server/onboarding_chain.py
#
# Every hook that needs to read/write onboarding state sources this file.
# State itself lives in tmp/hme-onboarding.state (single line) and
# tmp/hme-onboarding.target (briefed module name).
#
# The Python CLI is the source of truth — shell helpers are just ergonomic.
# Falls back gracefully to "graduated" if Python is unavailable.

_ONB_PROJECT="$PROJECT_ROOT"
_ONB_STATE_FILE="${_ONB_PROJECT}/tmp/hme-onboarding.state"
_ONB_TARGET_FILE="${_ONB_PROJECT}/tmp/hme-onboarding.target"
_ONB_PY="${_ONB_PROJECT}/tools/HME/service/server/onboarding_chain.py"

# Ordered state list — must match STATES in onboarding_chain.py
# Source of truth is the Python module; this array mirrors it. C1: a codegen
# check could pull STATES from onboarding_chain.py on every source. For now
# the arrays are kept in sync manually — if they drift, _onb_is_graduated
# becomes unreliable.
_ONB_STATES=(boot selftest_ok targeted edited reviewed piped verified graduated)

_onb_state() {
  # Fast path: read file directly (no Python spawn)
  if [ -f "$_ONB_STATE_FILE" ]; then
    local s
    s="$(cat "$_ONB_STATE_FILE" 2>/dev/null | tr -d '[:space:]')"
    if [ -n "$s" ]; then
      echo "$s"
      return
    fi
  fi
  echo "graduated"
}

_onb_target() {
  [ -f "$_ONB_TARGET_FILE" ] && cat "$_ONB_TARGET_FILE" 2>/dev/null | tr -d '[:space:]' || true
}

_onb_set_state() {
  local s="$1"
  if [ "$s" = "graduated" ]; then
    rm -f "$_ONB_STATE_FILE" "$_ONB_TARGET_FILE" 2>/dev/null
    return
  fi
  mkdir -p "$(dirname "$_ONB_STATE_FILE")"
  echo "$s" > "$_ONB_STATE_FILE"
}

_onb_set_target() {
  local t="$1"
  [ -z "$t" ] && return
  mkdir -p "$(dirname "$_ONB_TARGET_FILE")"
  echo "$t" > "$_ONB_TARGET_FILE"
}

_onb_is_graduated() {
  [ "$(_onb_state)" = "graduated" ]
}

# Returns 0 if current state index >= argument's index
_onb_at_or_past() {
  local target="$1" cur i cur_i=999 tgt_i=999
  cur="$(_onb_state)"
  for i in "${!_ONB_STATES[@]}"; do
    [ "${_ONB_STATES[$i]}" = "$cur" ] && cur_i=$i
    [ "${_ONB_STATES[$i]}" = "$target" ] && tgt_i=$i
  done
  [ "$cur_i" -ge "$tgt_i" ]
}

# Returns 0 if current state index < argument's index
_onb_before() {
  local target="$1"
  ! _onb_at_or_past "$target"
}

# Forward-only advance — refuses to move backward
_onb_advance_to() {
  local target="$1"
  if _onb_before "$target"; then
    _onb_set_state "$target"
    return 0
  fi
  return 1
}

# Human-readable step label for the current state
_onb_step_label() {
  local s; s="$(_onb_state)"
  case "$s" in
    boot)        echo "1/7 boot check (run i/hme-admin action=selftest)" ;;
    selftest_ok) echo "2/7 pick evolution target (run i/evolve focus=design)" ;;
    targeted)    echo "3/7 edit target module (Edit tool — briefing auto-chains)" ;;
    edited)      echo "4/7 audit changes (run i/review mode=forget)" ;;
    reviewed)    echo "5/7 run pipeline (Bash: npm run main)" ;;
    piped)       echo "6/7 await verdict (hooks advance automatically)" ;;
    verified)    echo "7/7 persist learning (run i/learn title=… content=…)" ;;
    graduated)   echo "graduated" ;;
    *)           echo "unknown ($s)" ;;
  esac
}

# Initialize state file — called from sessionstart.sh. Once graduated,
# stays graduated: the onboarding walkthrough is a first-run experience,
# not a per-session ritual. Re-booting it every session meant users who
# completed onboarding still saw step-1 "run hme_admin selftest" guidance
# forever, and every tool call hauled the full AUTO-CHAIN selftest output
# into the agent's context as spam.
_onb_init() {
  mkdir -p "$(dirname "$_ONB_STATE_FILE")"
  if [ -f "$_ONB_STATE_FILE" ] && [ "$(cat "$_ONB_STATE_FILE" 2>/dev/null)" = "graduated" ]; then
    return 0
  fi
  echo "boot" > "$_ONB_STATE_FILE"
  rm -f "$_ONB_TARGET_FILE"
}
