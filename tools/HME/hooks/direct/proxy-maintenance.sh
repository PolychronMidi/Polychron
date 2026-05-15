#!/usr/bin/env bash
# proxy-maintenance.sh: announce planned proxy-restart window.
# Usage: start [ttl_seconds]  | clear  | status   (default TTL 180s)
# While active, claude_adapter.js suppresses fail-LOUD banners (logged to
# hme-proxy-lifecycle.log instead). TTL <60s under-shoots supervisor cycle
# (10s poll * 3 miss + 25s worker cold-boot); 180s = safe restart window.

set +e

# Resolve repo root: $PROJECT_ROOT > $CLAUDE_PROJECT_DIR > walk-up.
_MAINT_ROOT=""
if [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/.git" ] && [ -d "$PROJECT_ROOT/src" ]; then
  _MAINT_ROOT="$PROJECT_ROOT"
elif [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ] && [ -d "$CLAUDE_PROJECT_DIR/src" ]; then
  _MAINT_ROOT="$CLAUDE_PROJECT_DIR"
else
  _maint_try="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"  # silent-ok: optional fallback path.
  while [ -n "$_maint_try" ] && [ "$_maint_try" != "/" ]; do
    if [ -d "$_maint_try/.git" ] && [ -d "$_maint_try/src" ]; then
      _MAINT_ROOT="$_maint_try"
      break
    fi
    _maint_try="$(dirname "$_maint_try")"
  done
fi
if [ -z "$_MAINT_ROOT" ]; then
  echo "[proxy-maintenance] cannot resolve project root; exiting" >&2
  exit 1
fi
_MAINT_FLAG="$_MAINT_ROOT/tmp/hme-proxy-maintenance.flag"

_action="${1:-}"
_ttl="${2:-180}"

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
      >> "$_MAINT_ROOT/log/hme-proxy-lifecycle.log"
    echo "proxy-maintenance: flag set at $_MAINT_FLAG (ttl=${_ttl}s)" >&2
    ;;
  clear)
    if [ -f "$_MAINT_FLAG" ]; then
      rm -f "$_MAINT_FLAG"
      ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      mkdir -p "$_MAINT_ROOT/log" 2>/dev/null
      echo "[$ts] [proxy-maintenance] window closed manually" \
        >> "$_MAINT_ROOT/log/hme-proxy-lifecycle.log"
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
    _start_epoch=$(date -d "$_start" +%s 2>/dev/null || echo 0)  # silent-ok: optional fallback path.
    _now=$(date +%s)
    _age=$((_now - _start_epoch))
    if [ "$_age" -lt "$_ttl" ] 2>/dev/null; then  # silent-ok: optional fallback path.
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
