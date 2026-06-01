#!/usr/bin/env bash

_hme_bg() {
  local name="$1" log_file="$2"
  shift 2
  [ "$#" -gt 0 ] || return 0
  if ! mkdir -p "$(dirname "$log_file")" 2>/dev/null; then
    printf '[hme-bg] log directory unavailable for %s: %s\n' "$name" "$log_file" >&2
    return 1
  fi
  local runtime_root="${PROJECT_ROOT}"
  local runtime_dir="$runtime_root/tools/HME/runtime"
  if ! mkdir -p "$runtime_dir" 2>/dev/null; then
    printf '[hme-bg] runtime directory unavailable for %s: %s\n' "$name" "$runtime_dir" >&2
    return 1
  fi
  local lock_name
  lock_name=$(printf '%s' "$name" | tr -c 'A-Za-z0-9_.-' '_')
  local lock_file="$runtime_dir/bg-${lock_name}.lock"
  (
    if command -v flock >/dev/null 2>&1; then
      if ! exec 199>"$lock_file"; then
        printf '[%s] fail %s lock-unavailable: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$lock_file"
        exit 1
      fi
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
      kill -TERM "-$pid" 2>/dev/null || true  # silent-ok: child may already have exited while timeout fired
      kill -TERM "$pid" 2>/dev/null || true  # silent-ok: child may already have exited while timeout fired
      sleep 1
      kill -KILL "-$pid" 2>/dev/null || true  # silent-ok: child may already have exited after TERM
      kill -KILL "$pid" 2>/dev/null || true  # silent-ok: child may already have exited after TERM
      wait "$pid" 2>/dev/null || true  # silent-ok: timeout path already reports 124
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

_hme_stdin_timeout_runner() {
  local stdin_payload="$1" seconds="$2" payload_file rc
  shift 2
  payload_file=$(mktemp "${TMPDIR:-/tmp}/hme-bg-stdin.XXXXXX") || return 1
  printf '%s' "$stdin_payload" >"$payload_file" || {
    rc=$?
    rm -f "$payload_file" 2>/dev/null || true  # silent-ok: temp cleanup after write failure
    return "$rc"
  }
  _hme_timeout_runner "$seconds" "$@" <"$payload_file"
  rc=$?
  rm -f "$payload_file" 2>/dev/null || true  # silent-ok: temp cleanup after child exit
  return "$rc"
}

_hme_bg_stdin_timeout() {
  local seconds="$1" name="$2" log_file="$3" stdin_payload="$4"
  shift 4
  _hme_bg "$name" "$log_file" _hme_stdin_timeout_runner "$stdin_payload" "$seconds" "$@"
}

_hme_bg_shell_timeout() {
  local seconds="$1" name="$2" log_file="$3" script="$4"
  local runtime_root="${PROJECT_ROOT}"
  local runtime_dir="$runtime_root/tools/HME/runtime/bg-scripts"
  local lock_name script_file
  lock_name=$(printf '%s' "$name" | tr -c 'A-Za-z0-9_.-' '_')
  if ! mkdir -p "$runtime_dir"; then
    printf '[%s] skip %s: bg script dir unavailable: %s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$runtime_dir" >>"$log_file" 2>/dev/null || true  # silent-ok: bg telemetry channel; hook safety state is independent
    return 0
  fi
  script_file=$(mktemp "$runtime_dir/${lock_name}.XXXXXX.sh") || {
    printf '[%s] skip %s: mktemp failed in %s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$runtime_dir" >>"$log_file" 2>/dev/null || true  # silent-ok: bg telemetry channel; hook safety state is independent
    return 0
  }
  if ! {
    printf '%s\n' '#!/usr/bin/env bash'
    printf '%s\n' 'trap '\''rm -f "$0"'\'' EXIT'
    printf '%s\n' "$script"
  } >"$script_file"; then
    rm -f "$script_file" 2>/dev/null || true  # silent-ok: best-effort cleanup after temp-script write failure
    printf '[%s] skip %s: failed to write temp bg script: %s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$script_file" >>"$log_file" 2>/dev/null || true  # silent-ok: bg telemetry channel; hook safety state is independent
    return 0
  fi
  chmod 700 "$script_file" 2>/dev/null || true  # silent-ok: bash reads the file directly; executable bit is diagnostic-only
  _hme_bg_timeout "$seconds" "$name" "$log_file" bash "$script_file"
}
