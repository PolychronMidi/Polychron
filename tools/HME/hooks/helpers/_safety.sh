#!/usr/bin/env bash
# Shared safety preamble for all HME hooks.
# Source this at the top of every hook script.
set -euo pipefail
# Load .env so hooks get PROJECT_ROOT and all HME_* vars without hardcoding paths.
# Path math: _safety.sh lives at tools/HME/hooks/helpers/_safety.sh;
# project root is three dirs up: helpers/ -> hooks/ -> HME/ -> tools/ is WRONG,
# correct ascent is helpers/ -> hooks/ -> HME/ -> tools/ -> Polychron/, i.e.
# helpers/../../../../ = project root. The previous path (../../.env) pointed
# at tools/HME/.env which doesn't exist — silent `|| true` hid the miss for
# months, so every hook was running without PROJECT_ROOT set, which silently
# broke the auto-commit path in stop.sh / userpromptsubmit.sh (git -C ""
# swallowed by 2>/dev/null).
_HME_ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.env"
if [ -f "$_HME_ENV_FILE" ]; then
  set -a; source "$_HME_ENV_FILE"; set +a
else
  echo "WARNING: _safety.sh cannot find .env at $_HME_ENV_FILE — hooks will run without PROJECT_ROOT/HME_* env vars" >&2
fi

# H3: Hook latency telemetry — each hook self-logs its wall time to
# log/hme-hook-latency.jsonl on exit via a trap. The HookLatencyVerifier
# reads this log and flags hooks that exceed 500ms p95.
# Sampled at 10% to avoid inflating the log on high-frequency hooks.
_HME_HOOK_START_NS="$(date +%s%N)"
_HME_HOOK_NAME="$(basename "${BASH_SOURCE[1]:-unknown}" .sh)"
# Hook-level verdict flag. Any hook can call `_stderr_verdict "..."`
# at any point to set a terse summary that _hme_emit_exit_verdict will
# forward to stderr at EXIT. If no verdict is set, the trap emits a
# default so Claude Code's "Stop hook feedback: No stderr output"
# placeholder never fires (that placeholder floods the agent's
# context with zero-value tokens every turn — observed 87×/session
# costing ~2k tokens of pure noise).
_HME_HOOK_VERDICT=""

_stderr_verdict() {
  # Set the one-line exit summary. Last call wins. Any hook can use this.
  _HME_HOOK_VERDICT="$1"
}

_hme_log_hook_latency() {
  # PROJECT_ROOT must come from .env (sourced above). Never silently fall back
  # to $(pwd) / cwd — that spawns orphan log/ dirs under whatever directory the
  # tool happened to be running in.
  if [ -z "${PROJECT_ROOT:-}" ] || [ ! -d "$PROJECT_ROOT/src" ]; then
    return 0
  fi
  local log_file="$PROJECT_ROOT/log/hme-hook-latency.jsonl"
  mkdir -p "$(dirname "$log_file")" 2>/dev/null
  printf '{"hook":"%s","duration_ms":%d,"ts":%s}\n' \
    "$_HME_HOOK_NAME" "$1" "$(date +%s)" >> "$log_file" 2>/dev/null
  # Rotate when log exceeds 10000 lines — keeps last 5000
  local size
  size=$(wc -l < "$log_file" 2>/dev/null || echo 0)
  if [ "$size" -gt 10000 ]; then
    tail -5000 "$log_file" > "${log_file}.tmp" 2>/dev/null \
      && mv "${log_file}.tmp" "$log_file" 2>/dev/null
  fi
}

# Composite EXIT trap. Captures the ORIGINAL exit code before any helper
# runs (latency log or stderr emission), computes elapsed once, then
# dispatches. Either the explicit verdict set by `_stderr_verdict` wins,
# or a MINIMAL default fires so the agent-side forwarded notification
# (Stop hook feedback: [cmd]: <stderr>) carries a short token instead
# of "No stderr output" filler — but without adding character overhead
# beyond the empty placeholder. Claude Code already shows the hook
# name in the notification header, so we omit it here; "ok" / "fail=<N>"
# is the smallest signal set that still distinguishes clean from broken.
_hme_exit_combined() {
  local code=$?
  local end_ns dur_ms
  end_ns="$(date +%s%N)"
  dur_ms=$(( (end_ns - _HME_HOOK_START_NS) / 1000000 ))
  _hme_log_hook_latency "$dur_ms"
  if [ -n "$_HME_HOOK_VERDICT" ]; then
    echo "$_HME_HOOK_VERDICT" >&2
  elif [ "$code" -ne 0 ]; then
    echo "fail=$code" >&2
  else
    echo "ok" >&2
  fi
  return $code
}
trap _hme_exit_combined EXIT

# ── Tunable constants (adjust here — not in individual hooks) ─────────────────
_HME_HTTP_PORT=9098
_HME_SRC_PATTERN='/Polychron/(src|tools|scripts|doc|lab)/'
_HME_EDIT_PATTERN='/Polychron/(src|tools|scripts|doc|lab)/'

# Safe curl: returns empty string on timeout/failure, never crashes the hook.
# Tracks failures via a rolling streak; after STREAK_WARN consecutive misses
# the next failure appends to hme-errors.log so LIFESAVER surfaces it at the
# next turn. Previously this fire-and-forgot with `2>/dev/null || echo ''`
# and silent 100% failure rates masqueraded as "worker returned nothing."
# Usage: result=$(_safe_curl "http://..." '{"key":"val"}')
# Threshold sourced from .env (HME_STREAK_WARN=5) so bash+node components
# share one knob. Fallback to 5 if .env load failed earlier.
_HME_CURL_STREAK_WARN="${HME_STREAK_WARN:-5}"
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
_safe_curl() {
  local url="$1" body="${2:-}"
  local out rc streak_file
  streak_file="$(_hme_curl_streak_path)"
  if [ -n "$body" ]; then
    out=$(curl -s --max-time 2 -X POST "$url" -H 'Content-Type: application/json' -d "$body" 2>/dev/null)
    rc=$?
  else
    out=$(curl -s --max-time 2 "$url" 2>/dev/null)
    rc=$?
  fi
  if [ $rc -ne 0 ]; then
    local streak
    streak=$(_safe_int "$(cat "$streak_file" 2>/dev/null)")
    streak=$((streak + 1))
    echo "$streak" > "$streak_file"
    if [ "$streak" -ge "$_HME_CURL_STREAK_WARN" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
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

# Emit hookSpecificOutput allow + additionalContext + systemMessage.
# additionalContext reaches Claude's next-turn context (load-bearing for
# the KB briefing / onboarding primer chain); systemMessage reaches the
# user terminal only (legacy display mirror). Previously we only emitted
# systemMessage, which meant Claude NEVER saw hook-injected briefings —
# the documented "hook-chaining" of KB briefing into Edit was silently
# broken for months. Proxy coherence_violation (inference_write_without_hme_read)
# was firing correctly against this gap the whole time.
# Usage: _emit_enrich_allow "message text"; exit 0
_emit_enrich_allow() {
  jq -n --arg msg "$1" '{"hookSpecificOutput":{"permissionDecision":"allow","additionalContext":$msg},"systemMessage":$msg}'
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
    echo "BLOCKED: Raw tool streak ${score}/${_STREAK_BLOCK}. Use an HME npm script (\`i/hme-read\`, \`i/review\`, \`i/trace\`, etc.) before continuing. They add KB context that raw tools miss." >&2
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
# Consolidated KB enrichment and validation via the worker at localhost:9098 (absorbed the shim).

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

# ── Activity bridge emit helper ──────────────────────────────────────────────
# Shorthand for emitting to hme-activity.jsonl. Args are --key=value pairs.
# Usage: _emit_activity file_written --session="$SID" --file="$F" --module="$M"
_emit_activity() {
  local event="$1"; shift
  python3 "$PROJECT_ROOT/tools/HME/activity/emit.py" \
    --event="$event" "$@" >/dev/null 2>&1 &
}
