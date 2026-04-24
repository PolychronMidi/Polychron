#!/usr/bin/env bash
# Autocommit — fail-fast-hardened single source of truth.
#
# Why this exists in its own helper:
# ---------------------------------
# The historical failure mode: stop.sh and userpromptsubmit.sh each had
# their own inline git-add / git-commit block that depended on
# $PROJECT_ROOT being set by .env. When .env failed to load (moved path,
# filesystem error, permissions), PROJECT_ROOT was empty; `git -C ""`
# silently no-op'd; the error went to stderr which _proxy_bridge.sh drops;
# and because the error log itself lives under $PROJECT_ROOT/log/, the
# fallback LIFESAVER path could not write either. All four channels
# collapsed together. The user observed autocommits fail 20 times without
# a single LIFESAVER alert.
#
# This helper decouples every failure channel from every other channel:
#   1. _AC_ROOT is derived from THIS file's own location; it cannot be
#      broken by .env misconfiguration.
#   2. A sticky fail-flag file (_AC_FAIL_FLAG) is written on every failure
#      path and deleted only on success. userpromptsubmit.sh LIFESAVER
#      scan checks for this file's existence independently of log content.
#   3. A monotonic attempt counter (_AC_COUNTER) increments on entry,
#      resets on success. If it climbs to 3+, the AutocommitHealthVerifier
#      fails the HCI at weight 5.0 — same tier as LifesaverIntegrity.
#   4. Failures are logged to FOUR independent channels in parallel. All
#      four must fail simultaneously for the error to go silent; any one
#      surviving reveals the failure.
#
# Channels on failure:
#   A. sticky fail-flag file  → checked every UserPromptSubmit directly
#   B. hme-errors.log         → LIFESAVER scan picks up new lines
#   C. stderr                 → _proxy_bridge drops, but visible locally
#   D. activity bridge        → coherence_violation event, picked up by
#                               downstream metrics and the HCI verifier
#
# Callers use:
#   _ac_do_commit "caller-name"
# and MUST NOT die on its return code — this function owns its own failure
# bookkeeping. The return code is informational for the caller only.

# Derive project root from OUR OWN PATH, not from env. This helper lives
# at tools/HME/hooks/helpers/_autocommit.sh. The project root is four
# levels up. If _safety.sh failed to load .env and PROJECT_ROOT is empty,
# this derivation still works, so all the bookkeeping below still runs.
_AC_SELF="${BASH_SOURCE[0]}"
_AC_ROOT="$(cd "$(dirname "$_AC_SELF")/../../../.." 2>/dev/null && pwd)"

_AC_STATE_DIR="$_AC_ROOT/tmp"
_AC_COUNTER="$_AC_STATE_DIR/hme-autocommit.counter"
_AC_LAST_SUCCESS="$_AC_STATE_DIR/hme-autocommit.last-success"
_AC_FAIL_FLAG="$_AC_STATE_DIR/hme-autocommit.fail"
_AC_LOCK_FILE="$_AC_STATE_DIR/hme-autocommit.lock"
_AC_ERROR_LOG="$_AC_ROOT/log/hme-errors.log"

# Threshold: counter value at which the attempt sequence is considered
# catastrophic. 3 consecutive attempts without a success between them is
# a strong signal of a wedged state that no amount of retries will fix.
_AC_COUNTER_FAIL_THRESHOLD=3

# ──────────────────────────────────────────────────────────────────────
# Helper: write a failure to every channel we can reach. Every channel is
# individually `|| true` guarded because we are the fallback of last
# resort — we never die for logging reasons.

_ac_record_failure() {
  local reason="$*"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown-ts")

  # Channel A: sticky fail-flag file. Overwrite on each failure so the
  # latest reason wins. Directory may not exist if state was wiped.
  mkdir -p "$_AC_STATE_DIR" 2>/dev/null || true
  echo "[$ts] $reason" > "$_AC_FAIL_FLAG" 2>/dev/null || true

  # Channel B: hme-errors.log for LIFESAVER pickup next UserPromptSubmit.
  # log/ may not exist — silently create before writing.
  mkdir -p "$(dirname "$_AC_ERROR_LOG")" 2>/dev/null || true
  echo "[$ts] [autocommit] $reason" >> "$_AC_ERROR_LOG" 2>/dev/null || true

  # Channel C: stderr. Even when _proxy_bridge drops this, local terminals
  # see it. Keep short and marked so search/grep locates it instantly.
  echo "[autocommit FAIL $ts] $reason" >&2 2>/dev/null || true

  # Channel D: activity bridge. Best-effort; silent-fails if python/env
  # unavailable. The HCI verifier still catches via the counter/flag.
  local emit_script="$_AC_ROOT/tools/HME/activity/emit.py"
  if [ -x "$emit_script" ] 2>/dev/null; then
    PROJECT_ROOT="$_AC_ROOT" python3 "$emit_script" \
      --event=coherence_violation --session=autocommit --verdict=FAIL \
      --payload="$reason" >/dev/null 2>&1 || true
  fi
}

# ──────────────────────────────────────────────────────────────────────
# Helper: begin an autocommit attempt. Increment counter FIRST so that if
# we die before recording success (segfault, SIGKILL, disk full, etc.),
# the counter stays elevated and the HCI verifier catches the wedge on the
# next run.

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

# ──────────────────────────────────────────────────────────────────────
# Helper: record a successful commit. Reset counter, update success
# timestamp, clear fail flag.

_ac_success() {
  mkdir -p "$_AC_STATE_DIR" 2>/dev/null || true
  echo 0 > "$_AC_COUNTER" 2>/dev/null || true
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$_AC_LAST_SUCCESS" 2>/dev/null || true
  rm -f "$_AC_FAIL_FLAG" 2>/dev/null || true
}

# ──────────────────────────────────────────────────────────────────────
# Core autocommit operation. Returns 0 on success, 1 on failure.
# Callers MUST append `|| true` at the call site — we own our bookkeeping
# and the return is informational only. The hook must NOT exit on our
# failure (the remaining lifecycle work still needs to run).
#
# Argument: caller name (e.g. "stop.sh" or "userpromptsubmit.sh"). Used
# in every failure record so the channel output is diagnosable.

_ac_do_commit() {
  local caller="${1:-unknown}"
  _ac_begin

  # Prereq validation — using _AC_ROOT derived from our own path, NOT
  # from $PROJECT_ROOT. This is load-bearing: the original silent-failure
  # bug was precisely PROJECT_ROOT being unset.
  if [ -z "$_AC_ROOT" ] || [ ! -d "$_AC_ROOT" ]; then
    _ac_record_failure "[$caller] _AC_ROOT derivation failed (self=$_AC_SELF, root=$_AC_ROOT)"
    return 1
  fi
  if [ ! -d "$_AC_ROOT/.git" ]; then
    _ac_record_failure "[$caller] .git not found at $_AC_ROOT — not a git repo or wrong root"
    return 1
  fi
  if [ ! -d "$_AC_ROOT/src" ]; then
    _ac_record_failure "[$caller] src/ not found at $_AC_ROOT — not a Polychron checkout"
    return 1
  fi

  # Flock for concurrent-commit serialization. Rapid Stop events can race
  # on .git/index.lock; an advisory lockfile bounds waiting to 30s.
  local _ac_err_buf
  _ac_err_buf=$(mktemp 2>/dev/null || echo "/tmp/hme-ac-err.$$")
  # shellcheck disable=SC2094
  exec 9>"$_AC_LOCK_FILE"
  if ! flock -w 30 9 2>/dev/null; then
    # Proceed without the lock — a silent skip is worse than a race.
    _ac_record_failure "[$caller] flock timeout 30s on $_AC_LOCK_FILE (proceeding unlocked)"
  fi

  # git add — failures previously went silently to 2>/dev/null; now captured.
  if ! git -C "$_AC_ROOT" add -A >"$_ac_err_buf" 2>&1; then
    _ac_record_failure "[$caller] git add -A failed: $(head -c 400 "$_ac_err_buf" 2>/dev/null | tr '\n' ' ')"
    rm -f "$_ac_err_buf" 2>/dev/null
    exec 9>&-
    return 1
  fi

  # git commit with single retry for transient lock contention.
  local commit_msg
  commit_msg="$(date +%Y-%m-%dT%H:%M:%S 2>/dev/null || echo autocommit)"
  if git -C "$_AC_ROOT" commit -m "$commit_msg" --quiet >"$_ac_err_buf" 2>&1; then
    _ac_success
    rm -f "$_ac_err_buf" 2>/dev/null
    exec 9>&-
    return 0
  fi
  # "nothing to commit" on stdout is not an error — tree matches HEAD.
  if grep -q "nothing to commit" "$_ac_err_buf" 2>/dev/null; then
    _ac_success
    rm -f "$_ac_err_buf" 2>/dev/null
    exec 9>&-
    return 0
  fi
  # Retry once. Transient index-lock contention between concurrent hooks
  # is the main intended retry case.
  sleep 1
  if git -C "$_AC_ROOT" commit -m "${commit_msg}-retry" --quiet >"$_ac_err_buf" 2>&1; then
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
      _nexus_mark COMMIT_FAILED "autocommit failed twice — uncommitted changes may exist" 2>/dev/null || true
    fi
  fi
  rm -f "$_ac_err_buf" 2>/dev/null
  exec 9>&-
  return 1
}

# ──────────────────────────────────────────────────────────────────────
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
      echo "autocommit counter at $n (≥$_AC_COUNTER_FAIL_THRESHOLD attempts without success)" >&2
      return 1
    fi
  fi
  return 0
}
