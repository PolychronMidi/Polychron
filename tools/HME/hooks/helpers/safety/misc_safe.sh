# Safe jq: extracts a field from JSON string, returns fallback on failure.
# Usage: count=$(_safe_jq "$json" '.kbCount' '0')
#
# FAIL-LOUD on REAL jq errors (parse failures, syntax errors). The previous
# implementation `2>/dev/null || result="$fallback"` silently swallowed
# jq parse errors -- a malformed JSON input produced "$fallback" with no
# trace. Now: jq stderr is captured; if jq exited non-zero AND wrote
# stderr, the error is bridged to hme-errors.log so the next LIFESAVER
# scan picks it up. Empty result / null result still silently use
# fallback (those are legitimate "field absent" semantics, not parse
# errors). Catches a structural class of silent-fails surfaced by the
# audit-silent-fails.py audit pass.
_safe_jq() {
  local json="$1" query="$2" fallback="${3:-}"
  if [ -z "$json" ]; then echo "$fallback"; return; fi
  local result jq_err jq_rc
  jq_err=$(mktemp 2>/dev/null || echo "/tmp/_safe_jq_err_$$")
  result=$(echo "$json" | jq -r "$query" 2>"$jq_err")
  jq_rc=$?
  if [ "$jq_rc" -ne 0 ] && [ -s "$jq_err" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
    local _jq_ts
    _jq_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    while IFS= read -r _jq_line; do
      [ -n "$_jq_line" ] && echo "[$_jq_ts] [_safe_jq] jq parse failed (query=$query): $_jq_line" \
        >> "$PROJECT_ROOT/log/hme-errors.log"
    done < "$jq_err"
    result="$fallback"
  elif [ -z "$result" ] || [ "$result" = "null" ]; then
    result="$fallback"
  fi
  rm -f "$jq_err" 2>/dev/null
  echo "$result"
}

# Safe python3: runs a python snippet, returns fallback on failure.
# Usage: result=$(_safe_py3 "print('ok')" 'fallback')
#
# FAIL-LOUD on python crashes. Was silently `2>/dev/null || echo $fallback`,
# letting ImportError / NameError / SyntaxError / RuntimeError vanish into
# the fallback string. Now stderr is captured; non-zero exit gets logged
# to hme-errors.log so LIFESAVER scans surface it.
_safe_py3() {
  local script="$1" fallback="${2:-}"
  local result py_err py_rc
  py_err=$(mktemp 2>/dev/null || echo "/tmp/_safe_py3_err_$$")
  result=$(python3 -c "$script" 2>"$py_err")
  py_rc=$?
  if [ "$py_rc" -ne 0 ] && [ -s "$py_err" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
    local _py_ts
    _py_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    # Truncate snippet for log readability; full error already on disk.
    local _py_script_tail
    _py_script_tail=$(printf '%s' "$script" | tr '\n' ' ' | head -c 80)
    while IFS= read -r _py_line; do
      [ -n "$_py_line" ] && echo "[$_py_ts] [_safe_py3] python3 failed (snippet=\"${_py_script_tail}\"): $_py_line" \
        >> "$PROJECT_ROOT/log/hme-errors.log"
    done < "$py_err"
    result="$fallback"
  fi
  rm -f "$py_err" 2>/dev/null
  echo "$result"
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

# Heartbeat: write a timestamp file proving a hook component executed.
# A watchdog (check-heartbeat-freshness.js) compares mtimes against
# expected freshness windows; stale = silent-fail.
# Usage: _hme_heartbeat <component-name>
# Writes: $PROJECT_ROOT/tmp/hme-heartbeat-<name>.ts (epoch seconds)
_hme_heartbeat() {
  local name="$1"
  [ -z "$name" ] && return 1
  [ -z "${PROJECT_ROOT:-}" ] && return 1
  local hb_dir="$PROJECT_ROOT/tmp"
  mkdir -p "$hb_dir" 2>/dev/null
  date +%s > "$hb_dir/hme-heartbeat-${name}.ts" 2>/dev/null
}

# Safe numeric check: returns 0 if value is not a valid integer.
# Usage: if [ "$(_safe_int "$val")" -gt 0 ]; then ...
_safe_int() {
  local val="$1"
  if [[ "$val" =~ ^-?[0-9]+$ ]]; then echo "$val"; else echo "0"; fi
}
