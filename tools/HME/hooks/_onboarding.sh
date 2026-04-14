#!/usr/bin/env bash
# HME onboarding shell helpers — thin bridge to server/onboarding_chain.py
#
# Every hook that needs to read/write onboarding state sources this file.
# State itself lives in tmp/hme-onboarding.state (single line) and
# tmp/hme-onboarding.target (briefed module name).
#
# The Python CLI is the source of truth — shell helpers are just ergonomic.
# Falls back gracefully to "graduated" if Python is unavailable.

_ONB_PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
_ONB_STATE_FILE="${_ONB_PROJECT}/tmp/hme-onboarding.state"
_ONB_TARGET_FILE="${_ONB_PROJECT}/tmp/hme-onboarding.target"
_ONB_PY="${_ONB_PROJECT}/tools/HME/mcp/server/onboarding_chain.py"

# Ordered state list — must match STATES in onboarding_chain.py
_ONB_STATES=(boot selftest_ok targeted briefed edited reviewed piped verified graduated)

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
    boot)        echo "1/8 boot check (run hme_admin selftest)" ;;
    selftest_ok) echo "2/8 pick evolution target (run evolve focus=design)" ;;
    targeted)    echo "3/8 brief on target (run read mode=before)" ;;
    briefed)     echo "4/8 edit target module (Edit tool)" ;;
    edited)      echo "5/8 audit changes (run review mode=forget)" ;;
    reviewed)    echo "6/8 run pipeline (Bash: npm run main)" ;;
    piped)       echo "7/8 await verdict (hooks advance automatically)" ;;
    verified)    echo "8/8 persist learning (run learn title=, content=)" ;;
    graduated)   echo "graduated" ;;
    *)           echo "unknown ($s)" ;;
  esac
}

# Initialize state file to 'boot' — called from sessionstart.sh
_onb_init() {
  mkdir -p "$(dirname "$_ONB_STATE_FILE")"
  echo "boot" > "$_ONB_STATE_FILE"
  rm -f "$_ONB_TARGET_FILE"
}
