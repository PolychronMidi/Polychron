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

# R32: LIFESAVER-aware background hook runner.
# Launches a command in background with a generous timeout. On non-zero exit,
# timeout, OR empty output, writes an entry to hme-errors.log so LIFESAVER
# surfaces the failure at the next turn.
#
# Use this for any hook that invokes local-LLM reasoning or long-running
# subprocesses. The R30-R31 pattern of `timeout 30 ... || true` silently
# swallowed failures and left LIFESAVER blind — this helper makes that
# class of failure impossible by construction.
#
# Usage: _lifesaver_bg <label> <timeout-seconds> <output-file> <command...>
# Example: _lifesaver_bg "review_auto_fire" 600 /tmp/out.txt ./i/review mode=forget
_lifesaver_bg() {
  local label="$1" tmo="$2" outfile="$3"
  shift 3
  [ -z "${PROJECT_ROOT:-}" ] && return 0
  local errlog="$PROJECT_ROOT/log/hme-errors.log"
  (
    timeout "$tmo" "$@" > "$outfile" 2>&1
    local rc=$?
    mkdir -p "$PROJECT_ROOT/log" 2>/dev/null
    if [ "$rc" -ne 0 ]; then
      printf '[%s] [%s] FAILED (rc=%d, timeout=%ss) — check %s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" "$rc" "$tmo" "$outfile" \
        >> "$errlog" 2>/dev/null
    elif [ ! -s "$outfile" ]; then
      printf '[%s] [%s] produced EMPTY output (rc=0 but no stdout) — downstream may be unreachable\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" \
        >> "$errlog" 2>/dev/null
    fi
  ) >/dev/null 2>&1 &
}

# Safe numeric check: returns 0 if value is not a valid integer.
# Usage: if [ "$(_safe_int "$val")" -gt 0 ]; then ...
_safe_int() {
  local val="$1"
  if [[ "$val" =~ ^-?[0-9]+$ ]]; then echo "$val"; else echo "0"; fi
}
