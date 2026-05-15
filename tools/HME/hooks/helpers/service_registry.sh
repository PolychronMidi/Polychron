#!/usr/bin/env bash

_hme_service_registry_py() {
  local cmd="$1" sid="$2"
  local root="${PROJECT_ROOT:-${CLAUDE_PROJECT_DIR:-}}"
  if [ -z "$root" ]; then
    local here="${PWD}"
    while [ -n "$here" ] && [ "$here" != "/" ]; do
      if [ -d "$here/.git" ] && [ -d "$here/tools/HME" ]; then
        root="$here"
        break
      fi
      here="$(dirname "$here")"
    done
  fi
  [ -n "$root" ] || return 2
  PROJECT_ROOT="$root" python3 "$root/tools/HME/scripts/service_registry.py" "$cmd" "$sid"
}

_hme_service_url() { _hme_service_registry_py url "$1"; }
_hme_service_port() { _hme_service_registry_py port "$1"; }
_hme_service_host() { _hme_service_registry_py host "$1"; }
_hme_service_process_patterns() { _hme_service_registry_py process-patterns "$1"; }
