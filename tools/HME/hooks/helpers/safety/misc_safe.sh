# safe jq extraction: returns fallback on absent field, FAIL-LOUD on parse errors
_safe_jq() {
  local json="$1" query="$2" fallback="${3:-}"
  if [ -z "$json" ]; then echo "$fallback"; return; fi
  local result jq_err jq_rc
  jq_err=$(mktemp "$PROJECT_ROOT/tools/HME/runtime/_safe_jq_err_XXXXXX" 2>/dev/null || echo "$PROJECT_ROOT/tools/HME/runtime/_safe_jq_err_$$")
  result=$(echo "$json" | jq -r "$query" 2>"$jq_err")
  jq_rc=$?
  if [ "$jq_rc" -ne 0 ] && [ -s "$jq_err" ] && [ -n "${PROJECT_ROOT}" ] && [ -d "$PROJECT_ROOT/log" ]; then
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

# safe python3: returns fallback on failure, FAIL-LOUD on crashes
_safe_py3() {
  local script="$1" fallback="${2:-}"
  local result py_err py_rc
  py_err=$(mktemp "$PROJECT_ROOT/tools/HME/runtime/_safe_py3_err_XXXXXX" 2>/dev/null || echo "$PROJECT_ROOT/tools/HME/runtime/_safe_py3_err_$$")
  result=$(python3 -c "$script" 2>"$py_err")
  py_rc=$?
  if [ "$py_rc" -ne 0 ] && [ -s "$py_err" ] && [ -n "${PROJECT_ROOT}" ] && [ -d "$PROJECT_ROOT/log" ]; then
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

# LIFESAVER-aware bg runner: timeout, log failures to hme-errors.log
_lifesaver_bg() {
  local label="$1" tmo="$2" outfile="$3"
  shift 3
  [ -z "${PROJECT_ROOT}" ] && return 0
  local errlog="$PROJECT_ROOT/log/hme-errors.log"
  (
    timeout "$tmo" "$@" > "$outfile" 2>&1
    local rc=$?
    mkdir -p "$PROJECT_ROOT/log" 2>/dev/null
    if [ "$rc" -ne 0 ]; then
      printf '[%s] [%s] FAILED (rc=%d, timeout=%ss) -- check %s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" "$rc" "$tmo" "$outfile" \
        >> "$errlog" 2>/dev/null  # silent-ok: optional fallback path.
    elif [ ! -s "$outfile" ]; then
      printf '[%s] [%s] produced EMPTY output (rc=0 but no stdout) -- downstream may be unreachable\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" \
        >> "$errlog" 2>/dev/null  # silent-ok: optional fallback path.
    fi
  ) >/dev/null 2>&1 &
}

# rationale: timestamp heartbeat for watchdog freshness checks; stale = silent-fail
_hme_heartbeat() {
  local name="$1"
  [ -z "$name" ] && return 1
  [ -z "${PROJECT_ROOT}" ] && return 1
  local hb_dir="$PROJECT_ROOT/tmp"
  mkdir -p "$hb_dir" 2>/dev/null
  date +%s > "$hb_dir/hme-heartbeat-${name}.ts" 2>/dev/null  # silent-ok: optional fallback path.
}

# Safe numeric check: returns 0 if value is not a valid integer.
_safe_int() {
  local val="$1"
  if [[ "$val" =~ ^-?[0-9]+$ ]]; then echo "$val"; else echo "0"; fi
}
