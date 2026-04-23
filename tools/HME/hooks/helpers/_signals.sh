#!/usr/bin/env bash
# HME unified signal bus (MVP).
#
# An append-only event log at output/metrics/hme-signals.jsonl. Proxy
# middleware, hook scripts, and activity emitters can all append — readers
# tail the file to see what fired, when, and from where. Replaces the
# patchwork of tmp/ files + _nexus.sh string parsing as the SINGLE source
# of truth for "what happened in this session." The _nexus_* helpers
# still exist — they're just no longer the ONLY answer to "is this
# lifecycle event done?"
#
# Schema (one JSON object per line):
#   {"ts": <epoch>, "event": "<name>", "source": "<origin>", "scope": "turn|session|round|pipeline", "payload": {...}, "requires_ack": false}
#
# Emit from bash:
#   _signal_emit <event> <source> <scope> '<payload-json>' [requires_ack]
#
# Read last N lines (safe for high-throughput bus):
#   _signal_tail <n>
#
# Filter last N matching an event:
#   _signal_last <event> [n]
#
# SIZE CONTROL: self-rotates at 10000 lines (keeps last 5000) to prevent
# unbounded growth. Same pattern as hme-hook-latency.jsonl.

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
    >> "$_SIGNAL_BUS" 2>/dev/null

  # Lightweight rotation (mod-N trigger to avoid wc on every emit).
  if [ $((RANDOM % 128)) -eq 0 ]; then
    local n
    n=$(wc -l < "$_SIGNAL_BUS" 2>/dev/null || echo 0)
    if [ "$n" -gt "$_SIGNAL_ROTATE_AT" ]; then
      tail -"$_SIGNAL_KEEP" "$_SIGNAL_BUS" > "${_SIGNAL_BUS}.rot" 2>/dev/null \
        && mv "${_SIGNAL_BUS}.rot" "$_SIGNAL_BUS" 2>/dev/null
    fi
  fi
}

_signal_tail() {
  local n="${1:-20}"
  [ -z "${PROJECT_ROOT:-}" ] || [ ! -f "$_SIGNAL_BUS" ] && return 0
  tail -"$n" "$_SIGNAL_BUS" 2>/dev/null
}

_signal_last() {
  local event="$1" n="${2:-5}"
  [ -z "${PROJECT_ROOT:-}" ] || [ ! -f "$_SIGNAL_BUS" ] && return 0
  grep -F "\"event\":\"$event\"" "$_SIGNAL_BUS" 2>/dev/null | tail -"$n"
}
