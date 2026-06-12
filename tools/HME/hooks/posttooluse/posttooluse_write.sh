#!/usr/bin/env bash
_HME_HELP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers"
source "$_HME_HELP_DIR/_hooks_bootstrap.sh"
# Post-write side effects are owned by proxy middleware/28_post_write_side_effects.js.
# Unfinished-todo deletion guard: a raw Write that overwrites doc/templates/TODO.md
source "$_HME_HELP_DIR/_check_errors_inline.sh"
source "$_HME_HELP_DIR/_todo_guard.sh"
INPUT=$(cat)
if ! _todo_guard_check "$INPUT"; then
  _hme_check_errors_inline || true
  exit 2
fi
_hme_check_errors_inline || true
exit 0
