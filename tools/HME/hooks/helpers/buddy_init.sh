#!/usr/bin/env bash
# Buddy system init helper — invoked by sessionstart.sh on every new HME
# session when .env BUDDY_SYSTEM=1 (default). Spawns a persistent
# Claude Code subagent session whose sid is recorded in
# tmp/hme-buddy.sid; the server-side dispatch_thread() in
# agent_direct.py picks up the sid and routes all reasoning calls
# through that single long-lived session for the rest of the HME
# session. Context accumulates across calls.
#
# Idempotent: if a buddy is already active (sid file present + non-
# empty), this script no-ops. The whole system can be toggled off via
# .env BUDDY_SYSTEM=0.
#
# Designed to be FAST + non-blocking when invoked from sessionstart:
# the actual claude subprocess is launched with disown so SessionStart
# returns immediately. The sid file appears once init completes
# (~10-20s after invocation); calls before that fall through to the
# ephemeral dispatch path.
set -euo pipefail

_REPO_ROOT="${CLAUDE_PROJECT_DIR:-${PROJECT_ROOT:-/home/jah/Polychron}}"
_SID_FILE="$_REPO_ROOT/tmp/hme-buddy.sid"

# Honor the .env toggle. BUDDY_SYSTEM defaults to 1; explicit 0 disables.
if [ -z "${BUDDY_SYSTEM:-}" ] && [ -f "$_REPO_ROOT/.env" ]; then
  _envline=$(grep -E '^BUDDY_SYSTEM=' "$_REPO_ROOT/.env" 2>/dev/null | head -1)
  [ -n "$_envline" ] && BUDDY_SYSTEM="${_envline#BUDDY_SYSTEM=}"
fi
BUDDY_SYSTEM="${BUDDY_SYSTEM:-1}"

[ "$BUDDY_SYSTEM" = "0" ] && exit 0

# Already active — sid file present and non-empty.
if [ -f "$_SID_FILE" ] && [ -s "$_SID_FILE" ]; then
  exit 0
fi

mkdir -p "$(dirname "$_SID_FILE")"

# The buddy's role prompt — same shape as the proven manual init,
# inlined here so this script is self-contained.
_init_prompt='You are the buddy — a persistent peer subagent for the Polychron codebase across this entire HME session. Reasoning tasks (review reflection, OVERDRIVE cascades, suggest_evolution, what_did_i_forget) arrive here as user messages; you reply with grounded reasoning. Accumulate context across tasks: a later task can build on what an earlier task surfaced. You MAY run read-only commands (Bash with `git diff`, `git show`, `git log`, `cat`, `grep`, the Read tool) to inspect the codebase when a prompt omits diff content. Do NOT edit files, run tests, or invoke long-running commands. Keep responses tight: max 4 concrete items per task. Cite file:line for every quoted finding.'

# Spawn in background so SessionStart returns immediately. The
# subprocess writes the sid file when init completes.
# HME_THREAD_CHILD=1 prevents the spawned claude from re-entering our
# own stop hooks (env name kept for back-compat with _proxy_bridge.sh).
{
  _out=$(HME_THREAD_CHILD=1 claude -p --output-format json "$_init_prompt" 2>/dev/null)
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
    printf '%s\n' "$_sid" > "$_SID_FILE"
    if [ -x "$_REPO_ROOT/tools/HME/activity/emit.py" ]; then
      PROJECT_ROOT="$_REPO_ROOT" python3 "$_REPO_ROOT/tools/HME/activity/emit.py" \
        --event=buddy_init --sid="$_sid" >/dev/null 2>&1 || true
    fi
  else
    # silent-ok: init failed, server-side dispatch falls through to
    # ephemeral path. A future SessionStart will retry.
    :
  fi
} >/dev/null 2>&1 &
disown 2>/dev/null || true

exit 0
