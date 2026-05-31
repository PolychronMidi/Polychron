#!/usr/bin/env bash
# Unfinished-todo deletion guard wiring. When a Write/Edit/MultiEdit touches
# doc/templates/TODO.md, compare the turn-start snapshot against the new file:

_todo_guard_check() {
  local input="$1"
  : "${PROJECT_ROOT:?PROJECT_ROOT must be resolved by _hooks_bootstrap before _todo_guard_check}"
  local file
  file=$(_safe_jq "$input" '.tool_input.file_path // .tool_input.path // ""' '' 2>/dev/null)
  case "$file" in
    */doc/templates/TODO.md|doc/templates/TODO.md) ;;
    *) return 0 ;;
  esac
  local before="${PROJECT_ROOT}/tmp/todo-turn-start.md"
  local after="${PROJECT_ROOT}/doc/templates/TODO.md"
  [ -f "$before" ] || return 0
  PROJECT_ROOT="${PROJECT_ROOT}" python3 \
    "${PROJECT_ROOT}/tools/HME/scripts/todo_guard.py" "$before" "$after" \
    >/dev/null 2>&1 || true
  return 0
}
