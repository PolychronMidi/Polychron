# Safe curl: returns empty string on timeout/failure, never crashes the hook.
# Tracks failures via a rolling streak; after STREAK_WARN consecutive misses
# the next failure appends to hme-errors.log so LIFESAVER surfaces it at the
# next turn. Previously this fire-and-forgot with `2>/dev/null || echo ''`
# and silent 100% failure rates masqueraded as "worker returned nothing."
# Curl failure threshold is fixed unless overridden explicitly.
: "${HME_CURL_STREAK_WARN:?HME_CURL_STREAK_WARN required}"
_HME_CURL_STREAK_WARN="$HME_CURL_STREAK_WARN"
# Streak file lives under $PROJECT_ROOT/tmp/ per the "no duplicate output dirs"
_hme_curl_streak_path() {
  if [ -n "${PROJECT_ROOT}" ] && [ -d "$PROJECT_ROOT/tmp" ]; then
    echo "$PROJECT_ROOT/tmp/hme-curl-fail.streak"
  else
    echo "$PROJECT_ROOT/tools/HME/runtime/hme-curl-fail.streak"
  fi
}
# During a planned proxy/worker restart (proxy-maintenance.sh start), the
_hme_maintenance_active() {
  local flag="${PROJECT_ROOT}/tmp/hme-proxy-maintenance.flag"
  [ -z "${PROJECT_ROOT}" ] && return 1
  [ ! -f "$flag" ] && return 1
  local ts ttl start_epoch now
  ts=$(sed -n '1p' "$flag" 2>/dev/null)
  ttl=$(sed -n '2p' "$flag" 2>/dev/null)
  case "$ttl" in
    ''|*[!0-9]*) return 1 ;;
  esac
  start_epoch=$(date -d "$ts" +%s 2>/dev/null || echo 0)  # silent-ok: optional fallback path.
  now=$(date +%s 2>/dev/null || echo 0)  # silent-ok: optional fallback path.
  [ "$start_epoch" -gt 0 ] && [ $((now - start_epoch)) -lt "$ttl" ]
}

_safe_curl() {
  local url="$1" body="${2:-}" explicit_timeout="${3:-}"
  local out rc streak_file max_time
  streak_file="$(_hme_curl_streak_path)"
  # Per-URL timeout: /reindex has a 180s budget on the worker side (slow
  if [ -n "$explicit_timeout" ]; then
    max_time="$explicit_timeout"
  else
    case "$url" in
      */reindex)     max_time=60 ;;   # substantial headroom short of 180s budget
      */transcript)  max_time=15 ;;   # lock contention under burst load
      */indexing-mode) max_time=600 ;; # full reindex, long-running
      *)             max_time=10 ;;   # default (was 5, bumped after sustained /transcript timeout spam)
    esac
  fi
  # FAIL-LOUD: capture curl stderr; if non-zero exit AND stderr written,
  local curl_err
  curl_err=$(mktemp "$PROJECT_ROOT/tools/HME/runtime/_safe_curl_err_XXXXXX" 2>/dev/null || echo "$PROJECT_ROOT/tools/HME/runtime/_safe_curl_err_$$")
  if [ -n "$body" ]; then
    out=$(curl -s --max-time "$max_time" -X POST "$url" -H 'Content-Type: application/json' -d "$body" 2>"$curl_err")
    rc=$?
  else
    out=$(curl -s --max-time "$max_time" "$url" 2>"$curl_err")
    rc=$?
  fi
  if [ $rc -ne 0 ]; then
    # Planned maintenance -- don't log, don't increment streak. The operator
    # already announced the window via proxy-maintenance.sh.
    if _hme_maintenance_active; then
      echo ''
      return 0
    fi
    local streak
    streak=$(_safe_int "$(cat "$streak_file" 2>/dev/null)")
    streak=$((streak + 1))
    echo "$streak" > "$streak_file"
    # FAIL-LOUD: log EVERY failure, not just streak >= threshold. Previously
    if [ -n "${PROJECT_ROOT}" ] && [ -d "$PROJECT_ROOT/log" ]; then
      local curl_msg=""
      [ -s "$curl_err" ] && curl_msg=$(head -c 200 "$curl_err" | tr '\n' ' ')
      # Severity classification: tag with WARN (observation) below
      local _sev="WARN"
      if [ "$streak" -ge "$_HME_CURL_STREAK_WARN" ]; then
        _sev="ERROR"
      fi
      # FAIL-LOUD on alert-sink writes -- was 2>/dev/null; if errors.log
      # itself is unwritable, that failure must NOT be silent.
      printf '[%s] [_safe_curl] %s %s failed (rc=%d, streak=%d)%s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$_sev" "$url" "$rc" "$streak" \
        "${curl_msg:+ -- $curl_msg}" \
        >> "$PROJECT_ROOT/log/hme-errors.log"
    fi
    rm -f "$curl_err" 2>/dev/null
    echo ''
    return 0
  fi
  # Success -- reset streak.
  rm -f "$curl_err" 2>/dev/null
  [ -f "$streak_file" ] && rm -f "$streak_file" 2>/dev/null
  echo "$out"
}
