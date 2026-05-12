#!/usr/bin/env bash
# Autocommit helper. 4 parallel failure channels (sticky flag, hme-errors.log,
# stderr, activity bridge) so no single break swallows errors.
# Caller: `_ac_do_commit "caller-name"`; MUST NOT die on return code.

# Project root: $PROJECT_ROOT > $CLAUDE_PROJECT_DIR > walk-up; no hardcoded fallback.
_AC_SELF="${BASH_SOURCE[0]}"
_AC_ROOT=""
if [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/.git" ] && [ -d "$PROJECT_ROOT/src" ]; then
  _AC_ROOT="$PROJECT_ROOT"
elif [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
  _AC_ROOT="$CLAUDE_PROJECT_DIR"
else
  _AC_TRY="$(cd "$(dirname "$_AC_SELF")" 2>/dev/null && pwd)"
  while [ -n "$_AC_TRY" ] && [ "$_AC_TRY" != "/" ]; do
    if [ -d "$_AC_TRY/.git" ] && [ -d "$_AC_TRY/src" ]; then
      _AC_ROOT="$_AC_TRY"
      break
    fi
    _AC_TRY="$(dirname "$_AC_TRY")"
  done
fi
if [ -z "$_AC_ROOT" ]; then
  echo "[_autocommit] cannot resolve project root (PROJECT_ROOT/CLAUDE_PROJECT_DIR/walk-up all failed); autocommit disabled this turn" >&2
  return 1 2>/dev/null || exit 1
fi

_AC_STATE_DIR="$_AC_ROOT/runtime/hme"
_AC_COUNTER="$_AC_STATE_DIR/autocommit.counter"
_AC_LAST_SUCCESS="$_AC_STATE_DIR/autocommit.last-success"
_AC_FAIL_FLAG="$_AC_STATE_DIR/autocommit.fail"
_AC_LOCK_FILE="$_AC_STATE_DIR/autocommit.lock"
_AC_ERROR_LOG="$_AC_ROOT/log/hme-errors.log"

# Threshold: counter value at which the attempt sequence is considered
# catastrophic. 3 consecutive attempts without a success between them is
# a strong signal of a wedged state that no amount of retries will fix.
_AC_COUNTER_FAIL_THRESHOLD=3

#
# Helper: write a failure to every channel we can reach. Every channel is
# individually `|| true` guarded because we are the fallback of last
# resort -- we never die for logging reasons.

_ac_record_failure() {
  local reason="$*"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown-ts")

  # Channel A: sticky fail-flag file. Overwrite on each failure so the
  # latest reason wins. Directory may not exist if state was wiped.
  mkdir -p "$_AC_STATE_DIR" 2>/dev/null || true
  echo "[$ts] $reason" > "$_AC_FAIL_FLAG" 2>/dev/null || true

  # Channel B: hme-errors.log for LIFESAVER pickup next UserPromptSubmit.
  # log/ may not exist -- silently create before writing.
  mkdir -p "$(dirname "$_AC_ERROR_LOG")" 2>/dev/null || true
  echo "[$ts] [autocommit] $reason" >> "$_AC_ERROR_LOG" 2>/dev/null || true

  # Channel C: stderr. Even when _proxy_bridge drops this, local terminals
  # see it. Keep short and marked so search/grep locates it instantly.
  echo "[autocommit FAIL $ts] $reason" >&2 2>/dev/null || true

  # Channel D: activity bridge. Best-effort; silent-fails if python/env
  # unavailable. The HCI verifier still catches via the counter/flag.
  local emit_script="$_AC_ROOT/tools/HME/activity/emit.py"
  if [ -x "$emit_script" ] 2>/dev/null; then
    # Horizon VII: caused_by = the autocommit-detected reason; lets
    # `i/why mode=causality coherence_violation` resolve Tier-1.5.
    PROJECT_ROOT="$_AC_ROOT" python3 "$emit_script" \
      --event=coherence_violation --session=autocommit --verdict=FAIL \
      --payload="$reason" --caused_by="autocommit:$reason" \
      >/dev/null 2>&1 || true
  fi
}

# Begin attempt: increment counter FIRST so a die-before-success leaves
# elevated count for HCI verifier to catch.

_ac_begin() {
  mkdir -p "$_AC_STATE_DIR" 2>/dev/null || true
  local n
  n=$(cat "$_AC_COUNTER" 2>/dev/null || echo 0)
  # Guard against garbage in the counter file (non-numeric).
  case "$n" in
    ''|*[!0-9]*) n=0 ;;
  esac
  echo $((n + 1)) > "$_AC_COUNTER" 2>/dev/null || true
}

#
# Helper: record a successful commit. Reset counter, update success
# timestamp, clear fail flag.

_ac_success() {
  mkdir -p "$_AC_STATE_DIR" 2>/dev/null || true
  echo 0 > "$_AC_COUNTER" 2>/dev/null || true
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$_AC_LAST_SUCCESS" 2>/dev/null || true
  rm -f "$_AC_FAIL_FLAG" 2>/dev/null || true
  # Heartbeat for watchdog freshness check.
  date +%s > "$_AC_STATE_DIR/heartbeat-autocommit.ts" 2>/dev/null || true
}

# Core autocommit. Returns 0/1; callers MUST `|| true` (we own bookkeeping).
# Argument: caller name (used in every failure record for diagnosis).

_ac_do_commit() {
  local caller="${1:-unknown}"
  _ac_begin

  # Prereq validation -- using _AC_ROOT derived from our own path, NOT
  # from $PROJECT_ROOT. This is load-bearing: the original silent-failure
  # bug was precisely PROJECT_ROOT being unset.
  if [ -z "$_AC_ROOT" ] || [ ! -d "$_AC_ROOT" ]; then
    _ac_record_failure "[$caller] _AC_ROOT derivation failed (self=$_AC_SELF, root=$_AC_ROOT)"
    return 1
  fi
  if [ ! -d "$_AC_ROOT/.git" ]; then
    _ac_record_failure "[$caller] .git not found at $_AC_ROOT -- not a git repo or wrong root"
    return 1
  fi
  if [ ! -d "$_AC_ROOT/src" ]; then
    _ac_record_failure "[$caller] src/ not found at $_AC_ROOT -- not a Polychron checkout"
    return 1
  fi

  # Stale-lock recovery: .git/index.lock can persist when a git process
  # crashes / is killed mid-add. Unlink only if no live process holds it.
  local _git_lock="$_AC_ROOT/.git/index.lock"
  if [ -f "$_git_lock" ]; then
    if ! fuser "$_git_lock" >/dev/null 2>&1; then
      rm -f "$_git_lock" 2>/dev/null
    fi
  fi
  # Flock for concurrent-commit serialization (advisory, 30s wait).
  local _ac_err_buf
  _ac_err_buf=$(mktemp 2>/dev/null || echo "/tmp/hme-ac-err.$$")
  # shellcheck disable=SC2094
  exec 9>"$_AC_LOCK_FILE"
  if ! flock -w 30 9 2>/dev/null; then
    _ac_record_failure "[$caller] flock timeout 30s on $_AC_LOCK_FILE (proceeding unlocked)"
  fi

  # git add -A runs best-effort (picks up new untracked files).  Failure
  # is non-fatal -- `commit -a` handles tracked-file modifications below.
  git -C "$_AC_ROOT" add -A >"$_ac_err_buf" 2>&1 || true

  # git commit with single retry for transient lock contention.
  local commit_msg
  commit_msg="$(date +%Y-%m-%dT%H:%M:%S 2>/dev/null || echo autocommit)"
  if git -C "$_AC_ROOT" commit -m "$commit_msg" --quiet >"$_ac_err_buf" 2>&1; then
    _ac_success
    rm -f "$_ac_err_buf" 2>/dev/null
    exec 9>&-
    return 0
  fi
  # "nothing to commit" on stdout is not an error -- tree matches HEAD.
  if grep -q "nothing to commit" "$_ac_err_buf" 2>/dev/null; then
    _ac_success
    rm -f "$_ac_err_buf" 2>/dev/null
    exec 9>&-
    return 0
  fi
  # Retry once. Transient index-lock contention between concurrent hooks
  # is the main intended retry case.
  sleep 1
  if git -C "$_AC_ROOT" commit -a -m "${commit_msg}-retry" --quiet >"$_ac_err_buf" 2>&1; then
    _ac_success
    rm -f "$_ac_err_buf" 2>/dev/null
    exec 9>&-
    return 0
  fi
  if grep -q "nothing to commit" "$_ac_err_buf" 2>/dev/null; then
    _ac_success
    rm -f "$_ac_err_buf" 2>/dev/null
    exec 9>&-
    return 0
  fi
  # Two consecutive git-commit failures. This is the catastrophic case.
  _ac_record_failure "[$caller] git commit failed twice: $(head -c 400 "$_ac_err_buf" 2>/dev/null | tr '\n' ' ')"
  # Also mark nexus for the agent-visible reminder, if available.
  if [ -f "$_AC_ROOT/tools/HME/hooks/helpers/_nexus.sh" ]; then
    # shellcheck source=/dev/null
    source "$_AC_ROOT/tools/HME/hooks/helpers/_nexus.sh" 2>/dev/null
    if declare -F _nexus_mark >/dev/null; then
      _nexus_mark COMMIT_FAILED "autocommit failed twice -- uncommitted changes may exist" 2>/dev/null || true
    fi
  fi
  rm -f "$_ac_err_buf" 2>/dev/null
  exec 9>&-
  return 1
}

#
# Read-only helper for the LIFESAVER UserPromptSubmit scan and other
# inspection points. Returns 0 if autocommit is healthy, 1 otherwise.
# Prints a short reason on stderr when unhealthy.

_ac_is_healthy() {
  # Fail flag existence trumps everything else.
  if [ -f "$_AC_FAIL_FLAG" ]; then
    echo "autocommit fail flag set: $(head -c 300 "$_AC_FAIL_FLAG" 2>/dev/null)" >&2
    return 1
  fi
  # Counter at or above threshold.
  if [ -f "$_AC_COUNTER" ]; then
    local n
    n=$(cat "$_AC_COUNTER" 2>/dev/null || echo 0)
    case "$n" in
      ''|*[!0-9]*) n=0 ;;
    esac
    if [ "$n" -ge "$_AC_COUNTER_FAIL_THRESHOLD" ]; then
      echo "autocommit counter at $n (>=$_AC_COUNTER_FAIL_THRESHOLD attempts without success)" >&2
      return 1
    fi
  fi
  return 0
}
