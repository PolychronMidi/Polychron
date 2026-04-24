#!/usr/bin/env bash
# Claude-Code-side hook forwarder. POSTs stdin to the proxy's /hme/lifecycle
# endpoint with ?event=<EventName>, relays the JSON response {stdout,
# stderr, exit_code} back to Claude Code.
#
# CRITICAL CHANGE (fail-LOUD, not fail-open):
# ------------------------------------------
# The old code exited 0 silently when the proxy was unreachable. That was
# the single largest silent-failure mode in the HME stack — proxy dies,
# every hook silently succeeds, LIFESAVER never fires (LIFESAVER itself
# lives inside the proxy), autocommits stop happening, KB briefings stop
# injecting, and the user is none the wiser. This recurred 20+ times.
#
# The fix: when the proxy is unreachable, emit a LIFESAVER banner as the
# hook's stdout JSON. Claude Code's plugin machinery surfaces this to the
# user on the very next turn. We also route the same banner through
# hme-errors.log (the existing LIFESAVER text-scan channel) so downstream
# monitors and the direct-autocommit hook pick it up too.
#
# We still never BLOCK Claude Code on proxy downtime (exit 0 is preserved)
# because wedging the whole agent on a proxy crash is worse than losing
# one turn of hook logic. The difference is: loud instead of silent.

EVENT="${1:-unknown}"
PORT="${HME_PROXY_PORT:-9099}"

# Recursion guard for thread children — narrow to events that would
# cause an auto-loop or pointless work. Original cut bypassed every
# event, which silently disabled PreToolUse safety (run.lock guard,
# secret detection, etc.) in the child session. Per CLAUDE.md the
# run.lock guard is "Enforced by PreToolUse hook + deny rule" — losing
# that half is real risk if the persistent subagent ever gains tool
# access. Keep PreToolUse / PostToolUse running; bypass only the
# loop-shaped lifecycle events.
case "$EVENT" in
  Stop|UserPromptSubmit|SessionStart|PreCompact|PostCompact)
    if [ "${HME_THREAD_CHILD:-}" = "1" ]; then
      exit 0
    fi
    ;;
esac

# Capture stdin (the Claude Code hook payload).
BODY=$(cat)

# Derive Polychron project root from THIS script's own path. If a plugin
# cache copy is being invoked, the path math still lands inside the cache
# tree; if that fails we fall back to a hardcoded Polychron root so the
# error logging path never dies for lack of a writable directory.
_PB_SELF="${BASH_SOURCE[0]}"
_PB_ROOT=""
# Cached copy lives at ~/.claude/plugins/cache/polychron-local/HME/1.0.0/hooks/;
# repo copy lives at <repo>/tools/HME/hooks/. Walk up to find a .git next to src/.
_pb_try="$(cd "$(dirname "$_PB_SELF")" 2>/dev/null && pwd)"
while [ -n "$_pb_try" ] && [ "$_pb_try" != "/" ]; do
  if [ -d "$_pb_try/.git" ] && [ -d "$_pb_try/src" ]; then
    _PB_ROOT="$_pb_try"
    break
  fi
  _pb_try="$(dirname "$_pb_try")"
done
# Fallback: Polychron's known checkout location on this host.
[ -z "$_PB_ROOT" ] && [ -d "/home/jah/Polychron/.git" ] && _PB_ROOT="/home/jah/Polychron"

# Meta-watchdog: every hook invocation cheaply verifies the
# proxy-supervisor is still alive. If the supervisor's pid file is
# missing OR the pid is not alive, respawn it detached. This resurrects
# the supervisor itself when it dies (OOM, SIGKILL, bash bug), using
# the existing per-event hook traffic as the heartbeat. The cost is one
# kill -0 + one stat per hook fire; the benefit is that the supervisor
# can no longer stay dead for a whole session just because the first
# watchdog at SessionStart didn't notice.
if [ -n "$_PB_ROOT" ]; then
  _PB_SUPERVISOR_SCRIPT="$_PB_ROOT/tools/HME/hooks/direct/proxy-supervisor.sh"
  _PB_SUPERVISOR_PID_FILE="$_PB_ROOT/tmp/hme-proxy-supervisor.pid"
  _PB_SV_ALIVE=0
  if [ -f "$_PB_SUPERVISOR_PID_FILE" ]; then
    _PB_SV_PID=$(cat "$_PB_SUPERVISOR_PID_FILE" 2>/dev/null)
    if [ -n "$_PB_SV_PID" ] && kill -0 "$_PB_SV_PID" 2>/dev/null; then
      _PB_SV_ALIVE=1
    fi
  fi
  if [ "$_PB_SV_ALIVE" = "0" ] && [ -x "$_PB_SUPERVISOR_SCRIPT" ]; then
    # Detached start. The supervisor's own start path is idempotent —
    # if it WAS already running we just haven't updated the pid file,
    # the second start will no-op. This never waits.
    bash "$_PB_SUPERVISOR_SCRIPT" start >/dev/null 2>&1 &
    disown 2>/dev/null || true
  fi

  # Same pattern for universal-pulse-supervisor: every hook invocation
  # cheaply verifies the active-probe daemon is alive. This is the
  # LIFESAVER gap-filler — without it, a GIL-saturated worker can stay
  # unresponsive for 48+ minutes before anyone notices (confirmed
  # incident, Apr 24 2026). The pulse runs its own health probes against
  # proxy/worker/llamacpp/CPU-saturation and writes to hme-errors.log
  # when targets go unresponsive, so LIFESAVER surfaces the outage at
  # the NEXT turn rather than hours later.
  _PB_UP_SUPERVISOR_SCRIPT="$_PB_ROOT/tools/HME/hooks/direct/universal-pulse-supervisor.sh"
  _PB_UP_PID_FILE="$_PB_ROOT/tmp/hme-universal-pulse-supervisor.pid"
  _PB_UP_ALIVE=0
  if [ -f "$_PB_UP_PID_FILE" ]; then
    _PB_UP_PID=$(cat "$_PB_UP_PID_FILE" 2>/dev/null)
    if [ -n "$_PB_UP_PID" ] && kill -0 "$_PB_UP_PID" 2>/dev/null; then
      _PB_UP_ALIVE=1
    fi
  fi
  if [ "$_PB_UP_ALIVE" = "0" ] && [ -x "$_PB_UP_SUPERVISOR_SCRIPT" ]; then
    bash "$_PB_UP_SUPERVISOR_SCRIPT" start >/dev/null 2>&1 &
    disown 2>/dev/null || true
  fi
fi

# POST to proxy. --max-time 60s accommodates stop.sh's longer chain
# (auto-commit + lifecycle checks).
RESP=$(curl -sf --max-time 60 -X POST \
  -H 'Content-Type: application/json' \
  --data-binary "$BODY" \
  "http://127.0.0.1:${PORT}/hme/lifecycle?event=${EVENT}" 2>/dev/null)

# One-shot retry after 500ms if the first POST failed. Covers the narrow
# window where the proxy has just finished a restart — /health may be
# returning 200 while /hme/lifecycle is still warming its route handler
# by ~100-400ms. Without the retry, ANY hook firing during that window
# logs "proxy unreachable" even though maintenance flag was set seconds
# earlier. The retry is a 500ms delay + single re-attempt — cheap for
# the happy path (instant skip), buys silent recovery on transient.
if [ -z "$RESP" ]; then
  sleep 0.5
  RESP=$(curl -sf --max-time 60 -X POST \
    -H 'Content-Type: application/json' \
    --data-binary "$BODY" \
    "http://127.0.0.1:${PORT}/hme/lifecycle?event=${EVENT}" 2>/dev/null)
fi

if [ -z "$RESP" ]; then
  # Proxy unreachable. FAIL LOUD, NOT FAIL OPEN.
  _PB_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)

  # Maintenance-flag check: if tmp/hme-proxy-maintenance.flag exists and
  # is younger than its declared TTL, a caller has announced a planned
  # restart. Suppress the fail-LOUD banner for this single invocation;
  # still emit a short stderr trace so the gap is audit-trailable, but
  # do NOT write to hme-errors.log (would trigger LIFESAVER) and do NOT
  # set the sticky fail flag.
  #
  # Flag format: two lines.
  #   line 1: ISO8601 timestamp the maintenance window started
  #   line 2: integer TTL seconds
  # Malformed or expired flag is ignored — we fail-LOUD as normal.
  _PB_MAINT_FLAG="$_PB_ROOT/tmp/hme-proxy-maintenance.flag"
  _PB_MAINT_ACTIVE=0
  if [ -n "$_PB_ROOT" ] && [ -f "$_PB_MAINT_FLAG" ]; then
    _PB_MAINT_START=$(sed -n '1p' "$_PB_MAINT_FLAG" 2>/dev/null)
    _PB_MAINT_TTL=$(sed -n '2p' "$_PB_MAINT_FLAG" 2>/dev/null)
    case "$_PB_MAINT_TTL" in
      ''|*[!0-9]*) ;;  # malformed — fall through to fail-LOUD
      *)
        _PB_MAINT_EPOCH=$(date -d "$_PB_MAINT_START" +%s 2>/dev/null || echo 0)
        _PB_NOW_EPOCH=$(date +%s 2>/dev/null || echo 0)
        if [ "$_PB_MAINT_EPOCH" -gt 0 ] \
            && [ $((_PB_NOW_EPOCH - _PB_MAINT_EPOCH)) -lt "$_PB_MAINT_TTL" ]; then
          _PB_MAINT_ACTIVE=1
        fi
        ;;
    esac
  fi

  if [ "$_PB_MAINT_ACTIVE" = "1" ]; then
    # Planned restart window. Drop one audit line to the lifecycle log,
    # skip every fail-LOUD channel.
    mkdir -p "$_PB_ROOT/log" 2>/dev/null
    echo "[$_PB_TS] [proxy-bridge] unreachable during planned maintenance window (event=${EVENT})" \
      >> "$_PB_ROOT/log/hme-proxy-lifecycle.log" 2>/dev/null
    echo "[proxy-bridge MAINTENANCE $_PB_TS] proxy down during maintenance window (event=${EVENT})" >&2
    exit 0
  fi

  _PB_MSG="[$_PB_TS] [proxy-bridge] HME proxy unreachable on 127.0.0.1:${PORT} (event=${EVENT}). No LIFESAVER, no KB briefing, no hook logic for this turn."

  # Channel A: hme-errors.log for LIFESAVER text-scan pickup.
  if [ -n "$_PB_ROOT" ]; then
    mkdir -p "$_PB_ROOT/log" 2>/dev/null
    echo "$_PB_MSG" >> "$_PB_ROOT/log/hme-errors.log" 2>/dev/null
    # Channel B: sticky proxy-down flag — separate from autocommit flag.
    mkdir -p "$_PB_ROOT/tmp" 2>/dev/null
    echo "$_PB_MSG" > "$_PB_ROOT/tmp/hme-proxy-down.flag" 2>/dev/null
  fi

  # Channel C: stderr. Even when plugin machinery swallows stderr, the
  # local proxy log catches it.
  echo "$_PB_MSG" >&2

  # Channel D: stdout as a Claude-Code-visible JSON banner on UserPromptSubmit
  # and SessionStart. These events accept additionalContext in their
  # hookSpecificOutput and relay it to the agent's next turn. For Stop /
  # PreToolUse / PostToolUse / PreCompact / PostCompact, emitting a JSON
  # block here would wedge the turn, so we keep them silent on stdout —
  # the other three channels carry the signal.
  case "$EVENT" in
    UserPromptSubmit|SessionStart)
      _PB_BANNER="🚨 LIFESAVER - HME PROXY OFFLINE - ALL HOOK LOGIC SILENTLY DISABLED

The HME proxy on 127.0.0.1:${PORT} is not responding. This means:
  - No LIFESAVER alerts will fire from the proxy path this turn
  - No KB briefings will inject before Edit calls
  - No jurisdiction rules apply
  - No onboarding walkthrough will advance

The direct autocommit hook (wired in parallel) is still running, so the
working tree will not be stranded. But every other HME feature is dead
until the proxy is restarted.

Restart: cd /home/jah/Polychron && node tools/HME/proxy/hme_proxy.js &
Check:   curl -sf http://127.0.0.1:${PORT}/health"
      jq -n --arg banner "$_PB_BANNER" --arg event "$EVENT" \
        '{"hookSpecificOutput":{"hookEventName":$event,"additionalContext":$banner},"systemMessage":$banner}'
      ;;
  esac

  exit 0
fi

# Proxy responded — clear the sticky down-flag, and emit a one-shot
# recovery banner if the flag was set (meaning the proxy WAS down before
# this call). The recovery banner parallels the fail-LOUD banner so the
# user knows normal service resumed.
#
# CRITICAL: the recovery note goes to stderr + a dedicated lifecycle log,
# NOT to hme-errors.log. The userpromptsubmit LIFESAVER scan text-matches
# every line in hme-errors.log as an error; routing a "recovered"
# message through it would fire a spurious LIFESAVER ERRORS banner on
# every successful recovery. Errors and recoveries are semantically
# different events and live in different files.
if [ -n "$_PB_ROOT" ] && [ -f "$_PB_ROOT/tmp/hme-proxy-down.flag" ]; then
  _PB_RECOVERY_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
  rm -f "$_PB_ROOT/tmp/hme-proxy-down.flag" 2>/dev/null
  mkdir -p "$_PB_ROOT/log" 2>/dev/null
  # Audit trail for recoveries — a separate file from the error log.
  echo "[$_PB_RECOVERY_TS] [proxy-bridge] HME proxy recovered on 127.0.0.1:${PORT} (event=${EVENT})" \
    >> "$_PB_ROOT/log/hme-proxy-lifecycle.log" 2>/dev/null
  echo "[proxy-bridge RECOVERED $_PB_RECOVERY_TS] HME proxy on 127.0.0.1:${PORT} responding again" >&2
fi
unset _PB_RECOVERY_TS 2>/dev/null

# Parse response and relay. jq is available in every Claude Code environment;
# this is the simplest way to pull structured fields from the JSON.
STDOUT=$(echo "$RESP" | jq -r '.stdout // ""' 2>/dev/null)
STDERR=$(echo "$RESP" | jq -r '.stderr // ""' 2>/dev/null)
EXIT_CODE=$(echo "$RESP" | jq -r '.exit_code // 0' 2>/dev/null)

[ -n "$STDOUT" ] && printf '%s' "$STDOUT"
[ -n "$STDERR" ] && printf '%s' "$STDERR" >&2
exit "${EXIT_CODE:-0}"
