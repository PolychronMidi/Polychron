# Streak helpers for hook safety.
#
# This file is sourced by helpers/_safety.sh so the safety helper manifest stays

_hme_streak_file() {
  local name="${1:-default}"
  echo "${PROJECT_ROOT}/tools/HME/runtime/${name}.streak"
}

_hme_streak_clear() {
  local name="${1:-default}"
  rm -f "$(_hme_streak_file "$name")" 2>/dev/null || true
}
