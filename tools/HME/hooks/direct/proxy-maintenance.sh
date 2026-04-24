#!/usr/bin/env bash
# proxy-maintenance.sh — announce a planned proxy restart window.
#
# Usage:
#   proxy-maintenance.sh start [ttl_seconds]   # default TTL 30s
#   proxy-maintenance.sh clear
#   proxy-maintenance.sh status                # read and print current flag
#
# While the flag is active, _proxy_bridge.sh skips its fail-LOUD banner
# path when the proxy is unreachable — the gap is logged to
# log/hme-proxy-lifecycle.log instead. Intended for scripts that
# intentionally cycle the proxy (e.g. after editing a proxy-side module).
#
# The flag auto-expires after TTL seconds. Malformed flag → fail-LOUD as
# normal. Explicit `clear` removes the flag immediately.

set +e

# Resolve repo root. BASH_SOURCE-relative ascent is UNSAFE from the
# plugin-cache path (lands in ~/.claude/plugins/cache/). Prefer
# CLAUDE_PROJECT_DIR, then hardcoded fallback.
_MAINT_ROOT=""
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
  _MAINT_ROOT="$CLAUDE_PROJECT_DIR"
fi
[ -z "$_MAINT_ROOT" ] && [ -d "/home/jah/Polychron/.git" ] && _MAINT_ROOT="/home/jah/Polychron"
_MAINT_FLAG="$_MAINT_ROOT/tmp/hme-proxy-maintenance.flag"

_action="${1:-}"
_ttl="${2:-30}"

case "$_action" in
  start)
    case "$_ttl" in
      ''|*[!0-9]*)
        echo "proxy-maintenance.sh: TTL must be a positive integer (got: $_ttl)" >&2
        exit 1
        ;;
    esac
    mkdir -p "$(dirname "$_MAINT_FLAG")" 2>/dev/null
    {
      date -u +"%Y-%m-%dT%H:%M:%SZ"
      printf '%s\n' "$_ttl"
    } > "$_MAINT_FLAG"
    # Audit trail.
    mkdir -p "$_MAINT_ROOT/log" 2>/dev/null
    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "[$ts] [proxy-maintenance] window opened (ttl=${_ttl}s)" \
      >> "$_MAINT_ROOT/log/hme-proxy-lifecycle.log" 2>/dev/null
    echo "proxy-maintenance: flag set at $_MAINT_FLAG (ttl=${_ttl}s)" >&2
    ;;
  clear)
    if [ -f "$_MAINT_FLAG" ]; then
      rm -f "$_MAINT_FLAG"
      ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      mkdir -p "$_MAINT_ROOT/log" 2>/dev/null
      echo "[$ts] [proxy-maintenance] window closed manually" \
        >> "$_MAINT_ROOT/log/hme-proxy-lifecycle.log" 2>/dev/null
      echo "proxy-maintenance: flag cleared" >&2
    else
      echo "proxy-maintenance: no flag to clear" >&2
    fi
    ;;
  status)
    if [ ! -f "$_MAINT_FLAG" ]; then
      echo "inactive"
      exit 0
    fi
    _start=$(sed -n '1p' "$_MAINT_FLAG" 2>/dev/null)
    _ttl=$(sed -n '2p' "$_MAINT_FLAG" 2>/dev/null)
    _start_epoch=$(date -d "$_start" +%s 2>/dev/null || echo 0)
    _now=$(date +%s)
    _age=$((_now - _start_epoch))
    if [ "$_age" -lt "$_ttl" ] 2>/dev/null; then
      echo "active  (started=$_start, ttl=${_ttl}s, age=${_age}s)"
    else
      echo "expired (started=$_start, ttl=${_ttl}s, age=${_age}s)"
    fi
    ;;
  *)
    echo "Usage: proxy-maintenance.sh {start [ttl_seconds]|clear|status}" >&2
    exit 2
    ;;
esac
