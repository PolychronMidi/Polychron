#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
# PostToolUse: mcp__HME__read — track briefed files for pre-edit verification.
INPUT=$(cat)
TARGET=$(_safe_jq "$INPUT" '.tool_input.target' '')
MODE=$(_safe_jq "$INPUT" '.tool_input.mode' 'auto')

# BRIEF nexus marker moved to proxy middleware (nexus_tracking.js).
# Shell hook retained only for streak reset (Claude-Code-internal state).

_streak_reset

exit 0
