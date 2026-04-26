#!/usr/bin/env bash
# Buddy system init helper — invoked by sessionstart.sh on every new HME
# session when .env BUDDY_SYSTEM=1. Spawns BUDDY_COUNT persistent Claude
# Code subagent sessions whose sids are recorded in tmp/hme-buddy-N.sid
# (or tmp/hme-buddy.sid for N=1, back-compat with single-buddy era).
#
# Each co-buddy is a separate `claude --resume <sid>` long-lived session
# with its own accumulated context. The dispatcher (server-side
# dispatch_thread() in agent_direct.py) picks tasks off the queue dir
# and routes each to a co-buddy whose tier matches via the
# `effective = max(item_tier, buddy_floor)` rule. Specialization emerges
# per buddy from task affinity rather than explicit assignment.
#
# Idempotent: existing sid files (non-empty) are preserved. Missing slots
# are spawned. The whole system can be toggled off via .env BUDDY_SYSTEM=0.
#
# Designed to be FAST + non-blocking when invoked from sessionstart:
# the actual claude subprocesses are launched with disown so SessionStart
# returns immediately. Sid files appear once init completes
# (~10-20s after invocation per buddy); calls before that fall through
# to the ephemeral dispatch path.
set -euo pipefail

_REPO_ROOT="${CLAUDE_PROJECT_DIR:-${PROJECT_ROOT:-/home/jah/Polychron}}"

# Honor the .env toggle. BUDDY_SYSTEM defaults to 1; explicit 0 disables.
if [ -z "${BUDDY_SYSTEM:-}" ] && [ -f "$_REPO_ROOT/.env" ]; then
  _envline=$(grep -E '^BUDDY_SYSTEM=' "$_REPO_ROOT/.env" 2>/dev/null | head -1)
  [ -n "$_envline" ] && BUDDY_SYSTEM="${_envline#BUDDY_SYSTEM=}"
fi
BUDDY_SYSTEM="${BUDDY_SYSTEM:-1}"
[ "$BUDDY_SYSTEM" = "0" ] && exit 0

# BUDDY_COUNT defaults to 1 (back-compat). Read from env or .env.
if [ -z "${BUDDY_COUNT:-}" ] && [ -f "$_REPO_ROOT/.env" ]; then
  _envline=$(grep -E '^BUDDY_COUNT=' "$_REPO_ROOT/.env" 2>/dev/null | head -1)
  [ -n "$_envline" ] && BUDDY_COUNT="${_envline#BUDDY_COUNT=}"
fi
BUDDY_COUNT="${BUDDY_COUNT:-1}"
# Sanity bound — N>10 is almost certainly a typo and would burn quota.
case "$BUDDY_COUNT" in
  ''|*[!0-9]*) BUDDY_COUNT=1 ;;
  *)
    if [ "$BUDDY_COUNT" -lt 1 ]; then BUDDY_COUNT=1; fi
    if [ "$BUDDY_COUNT" -gt 10 ]; then BUDDY_COUNT=10; fi
    ;;
esac

# Per-buddy model floors (comma-separated, length must equal BUDDY_COUNT).
# Falls back to all "medium" if missing or wrong length.
if [ -z "${BUDDY_MODEL_FLOORS:-}" ] && [ -f "$_REPO_ROOT/.env" ]; then
  _envline=$(grep -E '^BUDDY_MODEL_FLOORS=' "$_REPO_ROOT/.env" 2>/dev/null | head -1)
  [ -n "$_envline" ] && BUDDY_MODEL_FLOORS="${_envline#BUDDY_MODEL_FLOORS=}"
fi
BUDDY_MODEL_FLOORS="${BUDDY_MODEL_FLOORS:-medium}"
# Pad / trim floor list to BUDDY_COUNT.
IFS=',' read -ra _FLOORS <<< "$BUDDY_MODEL_FLOORS"
while [ "${#_FLOORS[@]}" -lt "$BUDDY_COUNT" ]; do _FLOORS+=("medium"); done

mkdir -p "$_REPO_ROOT/tmp"

# Spawn one buddy per slot. SID filename:
#   N=1: tmp/hme-buddy.sid (back-compat with single-buddy code paths)
#   N>1: tmp/hme-buddy-1.sid, tmp/hme-buddy-2.sid, ...
_spawn_buddy() {
  local slot="$1" floor="$2" sid_file="$3"
  # Already active — sid file present and non-empty.
  if [ -f "$sid_file" ] && [ -s "$sid_file" ]; then
    return 0
  fi
  # Per-buddy role prompt: same shape as the proven single-buddy init,
  # with floor + slot annotated so the buddy knows its role from the
  # outset. The dispatcher routes by tier; the prompt frames the buddy
  # as a peer that may receive any-tier work but never below its floor.
  local prompt
  prompt="You are co-buddy ${slot}/${BUDDY_COUNT} (model floor: ${floor}) — a persistent peer subagent for the Polychron codebase across this entire HME session. Reasoning tasks (review reflection, OVERDRIVE cascades, suggest_evolution, what_did_i_forget) arrive here as user messages; you reply with grounded reasoning. Accumulate context across tasks: a later task can build on what an earlier task surfaced. You MAY run read-only commands (Bash with \`git diff\`, \`git show\`, \`git log\`, \`cat\`, \`grep\`, the Read tool) to inspect the codebase when a prompt omits diff content. Do NOT edit files, run tests, or invoke long-running commands. Keep responses tight: max 4 concrete items per task. Cite file:line for every quoted finding. When your task is complete AND the queue is drained, emit a single line on stdout: [no-work] <one-line reason>. The dispatcher reads this as your idle declaration."
  {
    local _out _sid
    _out=$(HME_THREAD_CHILD=1 claude -p --output-format json "$prompt" 2>/dev/null)
    _sid=$(printf '%s' "$_out" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    if isinstance(data, list):
        for ev in data:
            if isinstance(ev, dict) and ev.get('type') == 'system' and ev.get('subtype') == 'init':
                sid = ev.get('session_id', '')
                if sid:
                    print(sid)
                    sys.exit(0)
        for ev in data:
            if isinstance(ev, dict) and ev.get('session_id'):
                print(ev['session_id'])
                sys.exit(0)
    elif isinstance(data, dict):
        print(data.get('session_id', ''))
except Exception:
    pass
" 2>/dev/null)
    if [ -n "$_sid" ]; then
      printf '%s\n' "$_sid" > "$sid_file"
      # Companion file: per-buddy floor (used by dispatcher for routing).
      printf '%s\n' "$floor" > "${sid_file%.sid}.floor"
      if [ -x "$_REPO_ROOT/tools/HME/activity/emit.py" ]; then
        PROJECT_ROOT="$_REPO_ROOT" python3 "$_REPO_ROOT/tools/HME/activity/emit.py" \
          --event=buddy_init --sid="$_sid" --slot="$slot" --floor="$floor" >/dev/null 2>&1 || true
      fi
    fi
    # silent-ok on init failure: server-side dispatch falls through to
    # ephemeral path; a future SessionStart will retry the missing slot.
  } >/dev/null 2>&1 &
  disown 2>/dev/null || true
}

if [ "$BUDDY_COUNT" -eq 1 ]; then
  # Single-buddy back-compat: write to legacy tmp/hme-buddy.sid path.
  _spawn_buddy 1 "${_FLOORS[0]}" "$_REPO_ROOT/tmp/hme-buddy.sid"
else
  # Multi-buddy fanout: per-slot sid files.
  for i in $(seq 1 "$BUDDY_COUNT"); do
    _spawn_buddy "$i" "${_FLOORS[$((i - 1))]}" "$_REPO_ROOT/tmp/hme-buddy-${i}.sid"
  done
fi

exit 0
