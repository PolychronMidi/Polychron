#!/usr/bin/env bash
# Direct-mode event adapter. Invoked by _proxy_bridge.sh when the proxy daemon
# is unreachable. It intentionally owns no Event -> hook routing table; all
# dispatch goes through tools/HME/event_kernel/cli.js so proxy-up and proxy-down
# modes share the same source of truth.

set +u +e

EVENT="${1:-unknown}"
export HME_HOOK_EVENT="$EVENT"

_DD_SELF="${BASH_SOURCE[0]}"
_DD_ROOT="${PROJECT_ROOT:-${CLAUDE_PROJECT_DIR:-}}"
if [ -z "$_DD_ROOT" ] || [ ! -d "$_DD_ROOT/tools/HME" ]; then
  _dd_try="$(cd "$(dirname "$_DD_SELF")" 2>/dev/null && pwd)"
  while [ -n "$_dd_try" ] && [ "$_dd_try" != "/" ]; do
    if [ -d "$_dd_try/.git" ] && [ -d "$_dd_try/tools/HME" ]; then
      _DD_ROOT="$_dd_try"
      break
    fi
    _dd_try="$(dirname "$_dd_try")"
  done
fi

export PROJECT_ROOT="$_DD_ROOT"
_DD_CLI="$_DD_ROOT/tools/HME/event_kernel/cli.js"

if [ -z "$_DD_ROOT" ] || [ ! -f "$_DD_CLI" ]; then
  echo "[direct_dispatch] cannot resolve event kernel for event=$EVENT" >&2
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[direct_dispatch] node unavailable; cannot run event kernel for event=$EVENT" >&2
  exit 0
fi

node "$_DD_CLI" "$EVENT"
exit $?
