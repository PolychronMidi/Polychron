# Safe curl: returns empty string on timeout/failure, never crashes the hook.
# Tracks failures via a rolling streak; after STREAK_WARN consecutive misses
# the next failure appends to hme-errors.log so LIFESAVER surfaces it at the
# next turn. Previously this fire-and-forgot with `2>/dev/null || echo ''`
# and silent 100% failure rates masqueraded as "worker returned nothing."
# Usage: result=$(_safe_curl "http://..." '{"key":"val"}')
# Threshold sourced from (in order): the streak calibrator's adaptive file
# at tmp/hme-streak-warn.txt (written by activity/streak_calibrator.py each
# round — closes the observation→action loop), then .env's HME_STREAK_WARN,
# then 5 as final fallback. The calibrator file overrides .env so the system
# self-tunes without requiring a manual .env edit.
_hme_load_streak_warn() {
  local calibrated_file="${PROJECT_ROOT:-}/tmp/hme-streak-warn.txt"
  if [ -n "${PROJECT_ROOT:-}" ] && [ -f "$calibrated_file" ]; then
    local v
    v=$(head -c 8 "$calibrated_file" 2>/dev/null | tr -cd '0-9')
    if [ -n "$v" ] && [ "$v" -ge 1 ] && [ "$v" -le 99 ]; then
      echo "$v"
      return
    fi
  fi
  echo "${HME_STREAK_WARN:-5}"
}
_HME_CURL_STREAK_WARN="$(_hme_load_streak_warn)"
# Streak file lives under $PROJECT_ROOT/tmp/ per the "no duplicate output dirs"
# rule in CLAUDE.md. Resolved at call time so a missing PROJECT_ROOT at source
# time doesn't lock us into /tmp/ — the .env load at the top of this file runs
# first, so by the time _safe_curl is called PROJECT_ROOT is almost always set.
_hme_curl_streak_path() {
  if [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/tmp" ]; then
    echo "$PROJECT_ROOT/tmp/hme-curl-fail.streak"
  else
    echo "/tmp/hme-curl-fail.streak"
  fi
}
# During a planned proxy/worker restart (proxy-maintenance.sh start), the
# fail-LOUD path in _proxy_bridge.sh is suppressed. _safe_curl must honor
# the SAME flag — otherwise its streak counter ticks up during legitimate
# restart windows and LIFESAVER fires spurious errors (rc=7/rc=28) that
# are actually "caller intentionally cycled the worker", not a real
# outage. Returns 0 if flag present AND within its declared TTL.
_hme_maintenance_active() {
  local flag="${PROJECT_ROOT:-}/tmp/hme-proxy-maintenance.flag"
  [ -z "${PROJECT_ROOT:-}" ] && return 1
  [ ! -f "$flag" ] && return 1
  local ts ttl start_epoch now
  ts=$(sed -n '1p' "$flag" 2>/dev/null)
  ttl=$(sed -n '2p' "$flag" 2>/dev/null)
  case "$ttl" in
    ''|*[!0-9]*) return 1 ;;
  esac
  start_epoch=$(date -d "$ts" +%s 2>/dev/null || echo 0)
  now=$(date +%s 2>/dev/null || echo 0)
  [ "$start_epoch" -gt 0 ] && [ $((now - start_epoch)) -lt "$ttl" ]
}

_safe_curl() {
  local url="$1" body="${2:-}" explicit_timeout="${3:-}"
  local out rc streak_file max_time
  streak_file="$(_hme_curl_streak_path)"
  # Per-URL timeout: /reindex has a 180s budget on the worker side (slow
  # bge-code-v1 embedding, up to 20 files). /transcript is fast per call
  # (~ms) but serializes on _transcript_lock and can exceed a tight
  # timeout when the session is firing many rapid tool calls. Match the
  # timeout to the endpoint's real cost instead of defaulting to a
  # too-tight universal value.
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
  if [ -n "$body" ]; then
    out=$(curl -s --max-time "$max_time" -X POST "$url" -H 'Content-Type: application/json' -d "$body" 2>/dev/null)
    rc=$?
  else
    out=$(curl -s --max-time "$max_time" "$url" 2>/dev/null)
    rc=$?
  fi
  if [ $rc -ne 0 ]; then
    # Planned maintenance — don't log, don't increment streak. The operator
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
    # the streak gate suppressed failures 1..(N-1), letting hooks silently
    # receive empty strings as if success. The streak count stays as a
    # diagnostic trend signal but every failure now surfaces immediately.
    if [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
      printf '[%s] [_safe_curl] %s failed (rc=%d, streak=%d)\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$url" "$rc" "$streak" \
        >> "$PROJECT_ROOT/log/hme-errors.log" 2>/dev/null
    fi
    echo ''
    return 0
  fi
  # Success — reset streak.
  [ -f "$streak_file" ] && rm -f "$streak_file" 2>/dev/null
  echo "$out"
}
