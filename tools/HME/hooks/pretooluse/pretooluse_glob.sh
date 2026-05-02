#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# PreToolUse: Glob -- streak tracking only (block patterns may be added back if needed).
INPUT=$(cat)

_streak_tick 10
if ! _streak_check; then exit 1; fi
exit 0
