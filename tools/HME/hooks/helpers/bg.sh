#!/usr/bin/env bash

_hme_bg() {
  local name="$1" log_file="$2"
  shift 2
  [ "$#" -gt 0 ] || return 0
  mkdir -p "$(dirname "$log_file")" 2>/dev/null || true
  (
    printf '[%s] start %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name"
    "$@"
    rc=$?
    printf '[%s] end %s exit=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$rc"
    exit "$rc"
  ) </dev/null >>"$log_file" 2>&1 &
}

_hme_bg_timeout() {
  local seconds="$1" name="$2" log_file="$3"
  shift 3
  _hme_bg "$name" "$log_file" timeout "${seconds}s" "$@"
}

_hme_bg_shell_timeout() {
  local seconds="$1" name="$2" log_file="$3" script="$4"
  _hme_bg_timeout "$seconds" "$name" "$log_file" bash -c "$script"
}
