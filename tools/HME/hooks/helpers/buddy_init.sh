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

# Per-buddy model floors (csv, length=BUDDY_COUNT). E1-E5 scale; legacy easy/medium/hard translate.
# `auto`: count<3 -> all E2; count>=3 -> [E2,E3,E4,...,E2]. Explicit list honored, padded with E2.
if [ -z "${BUDDY_MODEL_FLOORS:-}" ] && [ -f "$_REPO_ROOT/.env" ]; then
  _envline=$(grep -E '^BUDDY_MODEL_FLOORS=' "$_REPO_ROOT/.env" 2>/dev/null | head -1 || true)
  [ -n "$_envline" ] && BUDDY_MODEL_FLOORS="${_envline#BUDDY_MODEL_FLOORS=}"
fi
BUDDY_MODEL_FLOORS="${BUDDY_MODEL_FLOORS:-auto}"
# Translate legacy values (easy/medium/hard -> E2/E3/E4) for backward compat.
_translate_floor() {
  case "$1" in
    easy) echo "E2" ;;
    medium) echo "E3" ;;
    hard) echo "E4" ;;
    E1|E2|E3|E4|E5) echo "$1" ;;
    *) echo "E2" ;;
  esac
}
if [ "$BUDDY_MODEL_FLOORS" = "auto" ]; then
  if [ "$BUDDY_COUNT" -lt 3 ]; then
    _FLOORS=()
    for i in $(seq 1 "$BUDDY_COUNT"); do _FLOORS+=("E2"); done
  else
    _FLOORS=(E2 E3 E4)
    while [ "${#_FLOORS[@]}" -lt "$BUDDY_COUNT" ]; do _FLOORS+=("E2"); done
  fi
else
  IFS=',' read -ra _RAW_FLOORS <<< "$BUDDY_MODEL_FLOORS"
  _FLOORS=()
  for f in "${_RAW_FLOORS[@]}"; do _FLOORS+=("$(_translate_floor "$f")"); done
  while [ "${#_FLOORS[@]}" -lt "$BUDDY_COUNT" ]; do _FLOORS+=("E2"); done
fi

mkdir -p "$_REPO_ROOT/tmp"

# Hand-off paradigm: BUDDY_HANDOFF=1 + non-empty runtime/hme/buddy-primary.sid
# means that session IS the buddy. Mirror to legacy buddy.sid for back-compat.
# Safety-net only -- _promote() (buddy_handoff.py) writes the trio inline.
if [ "$BUDDY_HANDOFF" = "1" ]; then
  # ONE primary at a time -- force count=1 so fall-through spawns one inaugural.
  if [ "$BUDDY_COUNT" -gt 1 ]; then
    BUDDY_COUNT=1
    _FLOORS=("${_FLOORS[0]:-E2}")
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
      _PRIMARY_FLOOR="E2"
      _PRIMARY_EFFORT="low"
      [ -f "${_PRIMARY_FILE%.sid}.floor" ] && \
        _PRIMARY_FLOOR=$(_translate_floor "$(head -1 "${_PRIMARY_FILE%.sid}.floor" | tr -d '[:space:]')")
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
  # No primary -- fall through to spawn path; _spawn_buddy records inaugural.
  # Under HANDOFF=1 primary.sid is authoritative; clear stale legacy file so
  # _spawn_buddy's "already active" guard doesn't short-circuit the inaugural.
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
  # Delegate to buddy_spawn.py (canonical; ensure_primary imports it directly).
  # Background + disown so SessionStart returns fast. Path relative to THIS
  # file for sandboxed-test compatibility.
  local _self_dir _spawn_script
  _self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  _spawn_script="$_self_dir/../../scripts/buddy_spawn.py"
  local _flag=""
  if [ "${BUDDY_HANDOFF:-0}" = "1" ] && [ "$slot" = "1" ]; then
    _flag="--mark-inaugural-primary"
  fi
  # Log capture instead of >/dev/null 2>&1: silent-fail trains the operator to treat absent signal as positive (same antipattern this project flags everywhere). Append-mode file descriptor avoids subprocess.PIPE deadlock risk per consult-anchored KB entry.
  local _spawn_log="$_REPO_ROOT/log/hme-buddy-spawn.log"
  mkdir -p "$(dirname "$_spawn_log")" 2>/dev/null
  # Pre-log the attempt OUTSIDE the background block so a subshell that dies
  # before launching still leaves a trace -- LIFESAVER no-dilution.
  printf '[%s] spawn-init slot=%s floor=%s sid_file=%s flag=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$slot" "$floor" "$sid_file" "${_flag:-(none)}" >> "$_spawn_log" 2>/dev/null
  {
    printf '[%s] spawn slot=%s floor=%s sid_file=%s flag=%s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$slot" "$floor" "$sid_file" "${_flag:-(none)}" >> "$_spawn_log"
    PROJECT_ROOT="$_REPO_ROOT" python3 \
      "$_spawn_script" \
      --slot="$slot" --floor="$floor" \
      --buddy-count="$BUDDY_COUNT" \
      --sid-file="$sid_file" \
      $_flag \
      --project-root="$_REPO_ROOT" \
      >> "$_spawn_log" 2>&1
    printf '[%s] spawn-exit slot=%s rc=%s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$slot" "$?" >> "$_spawn_log"
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
