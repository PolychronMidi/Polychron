#!/usr/bin/env bash
# autocommit-daemon.sh — hook-independent, proxy-independent autocommit.
#
# Both prior autocommit paths have silent failure modes:
#   - hook (userpromptsubmit / stop): VS Code Claude extension drops hook
#     execution unpredictably; autocommit stops running with no signal
#   - proxy middleware (proxy_autocommit.js): only runs when the extension
#     actually routes its requests through the proxy; some extension paths
#     bypass ANTHROPIC_BASE_URL entirely
#
# This daemon doesn't care. It polls git status every HME_AUTOCOMMIT_INTERVAL
# seconds (default 10), commits any dirty state, and appends failures to
# log/hme-errors.log so lifesaver_inject picks them up.
#
# Self-idempotence via PID file — double-launch is a no-op.
# Stops on SIGTERM / SIGINT — PID file removed via trap.

set -u

PROJECT_ROOT="${PROJECT_ROOT:-/home/jah/Polychron}"
PID_FILE="$PROJECT_ROOT/tmp/hme-autocommit-daemon.pid"
ERR_LOG="$PROJECT_ROOT/log/hme-errors.log"
INTERVAL="${HME_AUTOCOMMIT_INTERVAL:-10}"

mkdir -p "$(dirname "$PID_FILE")" 2>/dev/null

# Self-idempotence: if a live instance owns the PID file, exit silently.
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    exit 0
  fi
fi
echo "$$" > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT INT TERM

_log_err() {
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$ts] [autocommit:daemon] $*" >> "$ERR_LOG"
}

_tick() {
  if [ ! -d "$PROJECT_ROOT/.git" ] || [ ! -d "$PROJECT_ROOT/src" ]; then
    _log_err "PROJECT_ROOT invalid ($PROJECT_ROOT) — daemon exiting"
    exit 1
  fi
  local dirty
  dirty=$(git -C "$PROJECT_ROOT" status --porcelain 2>&1)
  if [ -z "$dirty" ]; then return; fi
  local ts_iso
  ts_iso=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local add_out
  if ! add_out=$(git -C "$PROJECT_ROOT" add -A 2>&1); then
    _log_err "git add failed: $(echo "$add_out" | head -c 200)"
    return
  fi
  local commit_out
  commit_out=$(git -C "$PROJECT_ROOT" commit -m "$ts_iso" --quiet 2>&1)
  local commit_rc=$?
  if [ "$commit_rc" -ne 0 ]; then
    if echo "$commit_out" | grep -q "nothing to commit"; then
      return
    fi
    _log_err "git commit failed (rc=$commit_rc): $(echo "$commit_out" | head -c 300)"
  fi
}

# First tick immediately so the daemon doesn't wait INTERVAL seconds before
# its first commit — whatever's dirty at launch gets committed now.
_tick

while true; do
  sleep "$INTERVAL"
  _tick
done
