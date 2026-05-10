#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# PreToolUse: Glob -- streak tracking only (block patterns may be added back if needed).
INPUT=$(cat)

_streak_tick 10
if ! _streak_check; then exit 1; fi
# Bounded-reads vow: counts consecutive Read/Grep/Glob.
if [ -x "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" ]; then
  PROJECT_ROOT="${PROJECT_ROOT}" python3 "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" || exit 2
fi
exit 0
