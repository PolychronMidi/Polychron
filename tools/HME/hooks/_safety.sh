#!/usr/bin/env bash
# Shared safety preamble for all HME hooks.
# Source this at the top of every hook script.
set -euo pipefail

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
