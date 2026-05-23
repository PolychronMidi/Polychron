#!/usr/bin/env bash

_hme_bg() {
  local name="$1" log_file="$2"
  shift 2
  [ "$#" -gt 0 ] || return 0
  mkdir -p "$(dirname "$log_file")" 2>/dev/null || true
  local runtime_root="${PROJECT_ROOT}"
  local runtime_dir="$runtime_root/tools/HME/runtime"
  mkdir -p "$runtime_dir" 2>/dev/null || return 0
  local lock_name
  lock_name=$(printf '%s' "$name" | tr -c 'A-Za-z0-9_.-' '_')
  local lock_file="$runtime_dir/bg-${lock_name}.lock"
  (
    if command -v flock >/dev/null 2>&1; then
      exec 199>"$lock_file" || exit 0
      if ! flock -n 199 2>/dev/null; then
        printf '[%s] skip %s already-running\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name"
        exit 0
      fi
    fi
    printf '[%s] start %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name"
    "$@"
    rc=$?
    printf '[%s] end %s exit=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$rc"
    exit "$rc"
  ) </dev/null >>"$log_file" 2>&1 &
}

_hme_timeout_runner() {
  local seconds="$1"
  shift
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" 2>&1 &
  else
    "$@" 2>&1 &
  fi
  local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$seconds" ]; then
      kill -TERM "-$pid" 2>/dev/null || true
      kill -TERM "$pid" 2>/dev/null || true
      sleep 1
      kill -KILL "-$pid" 2>/dev/null || true
      kill -KILL "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
}

_hme_bg_timeout() {
  local seconds="$1" name="$2" log_file="$3"
  shift 3
  _hme_bg "$name" "$log_file" _hme_timeout_runner "$seconds" "$@"
}

_hme_bg_shell_timeout() {
  local seconds="$1" name="$2" log_file="$3" script="$4"
  _hme_bg_timeout "$seconds" "$name" "$log_file" bash -c "$script"
}
