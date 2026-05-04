#!/usr/bin/env bash
# Buddy init: spawn BUDDY_COUNT persistent `claude --resume <sid>` sessions,
# sids in runtime/hme/buddy-N.sid (runtime/hme/buddy.sid for N=1). Routed by
# agent_direct.dispatch_thread via `effective = max(item_tier, buddy_floor)`.
# Idempotent (preserves existing non-empty sid files), gated by .env
# BUDDY_SYSTEM=1, non-blocking spawn (disowned so SessionStart returns fast).
set -euo pipefail

_REPO_ROOT="${CLAUDE_PROJECT_DIR:-${PROJECT_ROOT:-/home/jah/Polychron}}"

# Honor the .env toggle. BUDDY_SYSTEM defaults to 1; explicit 0 disables.
if [ -z "${BUDDY_SYSTEM:-}" ] && [ -f "$_REPO_ROOT/.env" ]; then
  # `|| true` so pipefail doesn't abort when the .env lacks BUDDY_SYSTEM=.
  _envline=$(grep -E '^BUDDY_SYSTEM=' "$_REPO_ROOT/.env" 2>/dev/null | head -1 || true)
  [ -n "$_envline" ] && BUDDY_SYSTEM="${_envline#BUDDY_SYSTEM=}"
fi
BUDDY_SYSTEM="${BUDDY_SYSTEM:-1}"
[ "$BUDDY_SYSTEM" = "0" ] && exit 0

# Hand-off mode flag -- resolved early; the short-circuit block runs
# AFTER BUDDY_COUNT and _FLOORS are populated below (so it has access
# to those values when forcing count=1).
if [ -z "${BUDDY_HANDOFF:-}" ] && [ -f "$_REPO_ROOT/.env" ]; then
  # `|| true` so pipefail doesn't abort when the .env lacks BUDDY_HANDOFF=
  # (grep returns 1 on no-match). Same pattern any new env-fallback needs.
  _envline=$(grep -E '^BUDDY_HANDOFF=' "$_REPO_ROOT/.env" 2>/dev/null | head -1 || true)
  [ -n "$_envline" ] && BUDDY_HANDOFF="${_envline#BUDDY_HANDOFF=}"
fi
BUDDY_HANDOFF="${BUDDY_HANDOFF:-0}"

# BUDDY_COUNT defaults to 1 (back-compat). Read from env or .env.
if [ -z "${BUDDY_COUNT:-}" ] && [ -f "$_REPO_ROOT/.env" ]; then
  # `|| true` so pipefail doesn't abort when the .env lacks BUDDY_COUNT=.
  _envline=$(grep -E '^BUDDY_COUNT=' "$_REPO_ROOT/.env" 2>/dev/null | head -1 || true)
  [ -n "$_envline" ] && BUDDY_COUNT="${_envline#BUDDY_COUNT=}"
fi
BUDDY_COUNT="${BUDDY_COUNT:-1}"
# Sanity bound -- N>10 is almost certainly a typo and would burn quota.
case "$BUDDY_COUNT" in
  ''|*[!0-9]*) BUDDY_COUNT=1 ;;
  *)
    if [ "$BUDDY_COUNT" -lt 1 ]; then BUDDY_COUNT=1; fi
    if [ "$BUDDY_COUNT" -gt 10 ]; then BUDDY_COUNT=10; fi
    ;;
esac

# Per-buddy model floors (csv, length=BUDDY_COUNT). floor = min tier
# (effective = max(item_tier, floor)). easy=fully dynamic, hard=Opus always.
# `auto`: count<3 -> all easy; count>=3 -> [easy,medium,hard,...,easy].
# Explicit list honored as-is, padded with easy.
if [ -z "${BUDDY_MODEL_FLOORS:-}" ] && [ -f "$_REPO_ROOT/.env" ]; then
  # `|| true` so pipefail doesn't abort when the .env lacks BUDDY_MODEL_FLOORS=.
  _envline=$(grep -E '^BUDDY_MODEL_FLOORS=' "$_REPO_ROOT/.env" 2>/dev/null | head -1 || true)
  [ -n "$_envline" ] && BUDDY_MODEL_FLOORS="${_envline#BUDDY_MODEL_FLOORS=}"
fi
BUDDY_MODEL_FLOORS="${BUDDY_MODEL_FLOORS:-auto}"
if [ "$BUDDY_MODEL_FLOORS" = "auto" ]; then
  if [ "$BUDDY_COUNT" -lt 3 ]; then
    _FLOORS=()
    for i in $(seq 1 "$BUDDY_COUNT"); do _FLOORS+=("easy"); done
  else
    _FLOORS=(easy medium hard)
    while [ "${#_FLOORS[@]}" -lt "$BUDDY_COUNT" ]; do _FLOORS+=("easy"); done
  fi
else
  IFS=',' read -ra _FLOORS <<< "$BUDDY_MODEL_FLOORS"
  while [ "${#_FLOORS[@]}" -lt "$BUDDY_COUNT" ]; do _FLOORS+=("easy"); done
fi

mkdir -p "$_REPO_ROOT/tmp"

# Hand-off paradigm: BUDDY_HANDOFF=1 + non-empty runtime/hme/buddy-primary.sid
# means that session IS the buddy. Mirror to legacy buddy.sid for back-compat.
# Safety-net only -- _promote() (buddy_handoff.py) writes the trio inline.
if [ "$BUDDY_HANDOFF" = "1" ]; then
  # ONE primary at a time -- force count=1 so fall-through spawns one inaugural.
  if [ "$BUDDY_COUNT" -gt 1 ]; then
    BUDDY_COUNT=1
    _FLOORS=("${_FLOORS[0]:-easy}")
  fi
  # Auto-retire if primary crosses BUDDY_RETIRE_PCT before HANDOFF inherits.
  # Path resolved relative to THIS file (sandboxed-test compatible).
  _HANDOFF_SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  _HANDOFF_SCRIPT="$_HANDOFF_SELF_DIR/../../scripts/buddy_handoff.py"
  if [ -f "$_HANDOFF_SCRIPT" ]; then
    PROJECT_ROOT="$_REPO_ROOT" python3 "$_HANDOFF_SCRIPT" auto_retire_check \
      >/dev/null 2>&1 || true
  fi
  _PRIMARY_FILE="$_REPO_ROOT/runtime/hme/buddy-primary.sid"
  if [ -f "$_PRIMARY_FILE" ] && [ -s "$_PRIMARY_FILE" ]; then
    _PRIMARY_SID=$(head -1 "$_PRIMARY_FILE" | tr -d '[:space:]')
    if [ -n "$_PRIMARY_SID" ]; then
      printf '%s\n' "$_PRIMARY_SID" > "$_REPO_ROOT/runtime/hme/buddy.sid"
      _PRIMARY_FLOOR="easy"
      _PRIMARY_EFFORT="low"
      [ -f "${_PRIMARY_FILE%.sid}.floor" ] && \
        _PRIMARY_FLOOR=$(head -1 "${_PRIMARY_FILE%.sid}.floor" | tr -d '[:space:]')
      [ -f "${_PRIMARY_FILE%.sid}.effort_floor" ] && \
        _PRIMARY_EFFORT=$(head -1 "${_PRIMARY_FILE%.sid}.effort_floor" | tr -d '[:space:]')
      printf '%s\n' "$_PRIMARY_FLOOR" > "$_REPO_ROOT/tmp/hme-buddy.floor"
      printf '%s\n' "$_PRIMARY_EFFORT" > "$_REPO_ROOT/tmp/hme-buddy.effort_floor"
      if [ -x "$_REPO_ROOT/tools/HME/activity/emit.py" ]; then
        PROJECT_ROOT="$_REPO_ROOT" python3 "$_REPO_ROOT/tools/HME/activity/emit.py" \
          --event=buddy_handoff_primary --sid="$_PRIMARY_SID" \
          --floor="$_PRIMARY_FLOOR" >/dev/null 2>&1 || true
      fi
      exit 0
    fi
  fi
  # No primary recorded yet -- fall through to legacy spawn path. The
  # _spawn_buddy helper records the spawned sid as the inaugural primary.
  # Defensive: a legacy runtime/hme/buddy.sid from a pre-paradigm session
  # would short-circuit the inaugural spawn (`_spawn_buddy`'s "already
  # active" guard returns early when sid_file is non-empty). Under
  # HANDOFF=1, primary.sid is the authoritative "buddy alive" signal --
  # absence of primary.sid means we have no inheritance, so any existing
  # legacy file is stale and must be cleared before fall-through.
  rm -f "$_REPO_ROOT/runtime/hme/buddy.sid" \
        "$_REPO_ROOT/tmp/hme-buddy.floor" \
        "$_REPO_ROOT/tmp/hme-buddy.effort_floor"
fi

# Spawn one buddy per slot. SID filename:
#   N=1: runtime/hme/buddy.sid (back-compat with single-buddy code paths)
#   N>1: runtime/hme/buddy-1.sid, runtime/hme/buddy-2.sid, ...
_spawn_buddy() {
  local slot="$1" floor="$2" sid_file="$3"
  # Already active -- sid file present and non-empty.
  if [ -f "$sid_file" ] && [ -s "$sid_file" ]; then
    return 0
  fi
  # Spawn delegated to tools/HME/scripts/buddy_spawn.py (the canonical
  # spawn implementation, shared with cmd_ensure_primary in
  # buddy_handoff.py). SessionStart wants fire-and-forget -- we
  # background and disown so the SessionStart hook returns
  # immediately. The synchronous-spawn caller (ensure_primary) imports
  # buddy_spawn.spawn_buddy directly for a blocking call.
  # Path resolved relative to THIS file (not $_REPO_ROOT) so the helper
  # works under sandboxed tests where the repo's script tree isn't
  # mirrored into the test PROJECT_ROOT.
  local _self_dir _spawn_script
  _self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  _spawn_script="$_self_dir/../../scripts/buddy_spawn.py"
  local _flag=""
  if [ "${BUDDY_HANDOFF:-0}" = "1" ] && [ "$slot" = "1" ]; then
    _flag="--mark-inaugural-primary"
  fi
  {
    PROJECT_ROOT="$_REPO_ROOT" python3 \
      "$_spawn_script" \
      --slot="$slot" --floor="$floor" \
      --buddy-count="$BUDDY_COUNT" \
      --sid-file="$sid_file" \
      $_flag \
      --project-root="$_REPO_ROOT" \
      >/dev/null 2>&1
    # silent-ok on init failure: server-side dispatch falls through to
    # ephemeral path; a future SessionStart will retry the missing slot.
  } &
  disown 2>/dev/null || true
}

if [ "$BUDDY_COUNT" -eq 1 ]; then
  # Single-buddy back-compat: write to legacy runtime/hme/buddy.sid path.
  _spawn_buddy 1 "${_FLOORS[0]}" "$_REPO_ROOT/runtime/hme/buddy.sid"
else
  # Multi-buddy fanout: per-slot sid files.
  for i in $(seq 1 "$BUDDY_COUNT"); do
    _spawn_buddy "$i" "${_FLOORS[$((i - 1))]}" "$_REPO_ROOT/tmp/hme-buddy-${i}.sid"
  done
fi

exit 0
