#!/usr/bin/env bash
# CWD-aware hook guard for nested projects with their own Claude hooks.

_hme_project_has_own_hooks() {
  local event="${1:-}"
  local cwd="${2:-${PWD:-}}"
  local root="${PROJECT_ROOT}"
  [ -n "$event" ] || return 1
  [ -n "$cwd" ] || return 1

  local dir="$cwd"
  while [ -n "$dir" ] && [ "$dir" != "/" ]; do
    if [ -n "$root" ] && [ "$dir" = "$root" ]; then
      return 1
    fi
    local settings="$dir/.claude/settings.json"
    if [ -f "$settings" ]; then
      jq -e --arg event "$event" '.hooks[$event] | type == "array" and length > 0' "$settings" >/dev/null 2>&1 \
        && return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

_hme_should_skip_for_nested_hooks() {
  local event="${1:-}"
  local payload="${2:-{}}"
  local cwd
  cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null || true)  # silent-ok: optional fallback path.
  [ -n "$cwd" ] || cwd="${PWD:-}"
  _hme_project_has_own_hooks "$event" "$cwd"
}
