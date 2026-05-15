#!/usr/bin/env bash
# HME unified signal bus -- append-only JSONL at output/metrics/hme-signals.jsonl.
# Schema: {ts, event, source, scope:turn|session|round|pipeline, payload, requires_ack}
# API: _signal_emit / _signal_tail <n> / _signal_last <event> [n].
# Self-rotates at 10000 lines (keeps 5000).

_SIGNAL_BUS="${PROJECT_ROOT:-}/output/metrics/hme-signals.jsonl"
_SIGNAL_ROTATE_AT=10000
_SIGNAL_KEEP=5000

_signal_emit() {
  local event="$1" source="${2:-unknown}" scope="${3:-turn}" payload="${4:-{\}}" ack="${5:-false}"
  [ -z "${PROJECT_ROOT:-}" ] && return 0
  [ -z "$event" ] && return 0
  local ts; ts=$(date +%s)
  local dir; dir=$(dirname "$_SIGNAL_BUS")
  mkdir -p "$dir" 2>/dev/null
  printf '{"ts":%s,"event":"%s","source":"%s","scope":"%s","payload":%s,"requires_ack":%s}\n' \
    "$ts" "$event" "$source" "$scope" "$payload" "$ack" \
    >> "$_SIGNAL_BUS" 2>/dev/null  # silent-ok: optional fallback path.

  # Lightweight rotation (mod-N trigger to avoid wc on every emit).
  if [ $((RANDOM % 128)) -eq 0 ]; then
    local n
    n=$(wc -l < "$_SIGNAL_BUS" 2>/dev/null || echo 0)  # silent-ok: optional fallback path.
    if [ "$n" -gt "$_SIGNAL_ROTATE_AT" ]; then
# silent-ok: optional fallback path.
      tail -"$_SIGNAL_KEEP" "$_SIGNAL_BUS" > "${_SIGNAL_BUS}.rot" 2>/dev/null \
        && mv "${_SIGNAL_BUS}.rot" "$_SIGNAL_BUS" 2>/dev/null  # silent-ok: optional fallback path.
    fi
  fi
}

_signal_tail() {
  local n="${1:-20}"
  [ -z "${PROJECT_ROOT:-}" ] || [ ! -f "$_SIGNAL_BUS" ] && return 0
  tail -"$n" "$_SIGNAL_BUS" 2>/dev/null  # silent-ok: optional fallback path.
}

_signal_last() {
  local event="$1" n="${2:-5}"
  [ -z "${PROJECT_ROOT:-}" ] || [ ! -f "$_SIGNAL_BUS" ] && return 0
  grep -F "\"event\":\"$event\"" "$_SIGNAL_BUS" 2>/dev/null | tail -"$n"  # silent-ok: optional fallback path.
}
