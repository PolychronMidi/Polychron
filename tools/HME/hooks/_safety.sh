#!/usr/bin/env bash
# Shared safety preamble for all HME hooks.
# Source this at the top of every hook script.
set -euo pipefail

# ── Tunable constants (adjust here — not in individual hooks) ─────────────────
_HME_HTTP_PORT=7734
_HME_SRC_PATTERN='/Polychron/(src|tools/HME/(chat/src|mcp/server))/'
_HME_EDIT_PATTERN='/Polychron/(src|tools/HME/(chat/src|mcp/server)|scripts)/'

# Safe curl: returns empty string on timeout/failure, never crashes the hook.
# Usage: result=$(_safe_curl "http://..." '{"key":"val"}')
_safe_curl() {
  local url="$1" body="${2:-}"
  if [ -n "$body" ]; then
    curl -s --max-time 2 -X POST "$url" -H 'Content-Type: application/json' -d "$body" 2>/dev/null || echo ''
  else
    curl -s --max-time 2 "$url" 2>/dev/null || echo ''
  fi
}

# Safe jq: extracts a field from JSON string, returns fallback on failure.
# Usage: count=$(_safe_jq "$json" '.kbCount' '0')
_safe_jq() {
  local json="$1" query="$2" fallback="${3:-}"
  if [ -z "$json" ]; then echo "$fallback"; return; fi
  local result
  result=$(echo "$json" | jq -r "$query" 2>/dev/null) || result="$fallback"
  if [ -z "$result" ] || [ "$result" = "null" ]; then result="$fallback"; fi
  echo "$result"
}

# Safe python3: runs a python snippet, returns fallback on failure.
# Usage: result=$(_safe_py3 "print('ok')" 'fallback')
_safe_py3() {
  local script="$1" fallback="${2:-}"
  python3 -c "$script" 2>/dev/null || echo "$fallback"
}

# Safe numeric check: returns 0 if value is not a valid integer.
# Usage: if [ "$(_safe_int "$val")" -gt 0 ]; then ...
_safe_int() {
  local val="$1"
  if [[ "$val" =~ ^-?[0-9]+$ ]]; then echo "$val"; else echo "0"; fi
}

# ── Hook output emitters ──────────────────────────────────────────────────────

# Emit hookSpecificOutput allow + systemMessage (enrichment/warnings).
# Usage: _emit_enrich_allow "message text"; exit 0
_emit_enrich_allow() {
  jq -n --arg msg "$1" '{"hookSpecificOutput":{"permissionDecision":"allow"},"systemMessage":$msg}'
}

# Emit hard block decision (required format for built-in tools + hard rules).
# Outputs JSON to stdout; caller must still: exit 2
# Usage: _emit_block "BLOCKED: reason"; exit 2
_emit_block() {
  jq -n --arg reason "$1" '{"decision":"block","reason":$reason}'
}

# ── Path / module helpers ─────────────────────────────────────────────────────

# Returns 0 if PATH is a project source file (src/ or HME chat/mcp).
_is_project_src() { echo "$1" | grep -qE "$_HME_SRC_PATTERN"; }

# Returns 0 if PATH is a project editable source file (adds scripts/).
_is_project_edit_src() { echo "$1" | grep -qE "$_HME_EDIT_PATTERN"; }

# Extract module name: strip directory + any file extension.
# "src/foo/barBaz.js" → "barBaz"
_extract_module() { basename "$1" | sed 's/\.[^.]*$//'; }

# ── Streak counter ────────────────────────────────────────────────────────
# Weighted tool-type streak tracking. Weight guide:
#   Read=5 (0.5x), Edit/Write=10 (1x), Bash=15 (1.5x), Grep=20 (2x)
# Thresholds: warn at 50, block at 70 (equivalent to 5/7 raw calls at 1x).
_STREAK_FILE="/tmp/hme-non-hme-streak.score"
_STREAK_WARN=50
_STREAK_BLOCK=70

_streak_tick() {
  local weight="${1:-10}"
  local score
  score=$(_safe_int "$(cat "$_STREAK_FILE" 2>/dev/null)")
  score=$((score + weight))
  echo "$score" > "$_STREAK_FILE"
}

_streak_check() {
  local score
  score=$(_safe_int "$(cat "$_STREAK_FILE" 2>/dev/null)")
  if [ "$score" -ge "$_STREAK_BLOCK" ]; then
    echo "BLOCKED: Raw tool streak ${score}/${_STREAK_BLOCK}. Use an mcp__HME__ tool (read, find, review) before continuing. They add KB context that raw tools miss." >&2
    return 1
  elif [ "$score" -ge "$_STREAK_WARN" ]; then
    echo "REMINDER: Raw tool streak ${score}/${_STREAK_BLOCK}. Use HME tools (read, find, review) for KB-enriched results." >&2
  fi
  return 0
}

_streak_reset() {
  echo 0 > "$_STREAK_FILE"
}

# ── HME HTTP shim helpers ─────────────────────────────────────────────────
# Consolidated KB enrichment and validation via the localhost:7734 shim.

_hme_enrich() {
  local module="$1" top_k="${2:-3}"
  _safe_curl "http://127.0.0.1:${_HME_HTTP_PORT}/enrich" "{\"query\":\"$module\",\"top_k\":$top_k}"
}

_hme_validate() {
  local module="$1"
  _safe_curl "http://127.0.0.1:${_HME_HTTP_PORT}/validate" "{\"query\":\"$module\"}"
}

_hme_kb_count() {
  local json="$1"
  _safe_int "$(_safe_jq "$json" '.kb | length' '0')"
}

_hme_kb_titles() {
  local json="$1" max="${2:-3}"
  _safe_jq "$json" '.kb[]?.title // empty' '' | head -"$max" | sed 's/^/    /'
}
