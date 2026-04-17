#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_onboarding.sh"
# PreToolUse: Edit — ellipsis-stub block (true pre-execution reject) + onboarding
# warn. Activity emission, BRIEF check, and KB enrichment moved to proxy middleware.
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
NEW_STRING=$(_safe_jq "$INPUT" '.tool_input.new_string' '')

if echo "$NEW_STRING" | grep -qiE '(#|//|/\*)[[:space:]]*(\.\.\.)?[[:space:]]*(existing|rest of|previous)[[:space:]]+(code|file|implementation|content|functions?)[[:space:]]*(\.\.\.)?'; then
  _emit_block "BLOCKED: Edit new_string contains comment-ellipsis stub placeholder. Use the ACTUAL replacement content — no stubs."
  exit 2
fi

# Pre-save pattern lint — block new_string before it lands if it introduces
# forbidden patterns. Each block cites the rule + the fix, so the message
# alone is enough for the agent to correct the edit.
if echo "$FILE" | grep -qE '\.(js|ts|tsx|mjs|cjs)$'; then
  if echo "$NEW_STRING" | grep -qE '\bglobalThis\.|(^|[^a-zA-Z_])global\.[a-zA-Z_]'; then
    _emit_block "BLOCKED: new_string uses global. or globalThis. — 5 Core Principles #1 forbids these. Reference the global directly (declared in globals.d.ts)."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE '\|\|[[:space:]]*(0|\[\]|\{\})([^a-zA-Z0-9_]|$)'; then
    _emit_block "BLOCKED: new_string uses || 0 / || [] / || {} fallback — 5 Core Principles #2 requires fail-fast. Use validator.optionalFinite(val, fallback) or validator.create('Module') + required checks."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE '\.getSnapshot\(\)[[:space:]]*\.[[:space:]]*couplingMatrix'; then
    _emit_block "BLOCKED: new_string reads .couplingMatrix off getSnapshot() — forbidden outside coupling engine / meta-controllers (local/no-direct-coupling-matrix-read). Register a bias via conductorIntelligence instead."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE '\bconsole\.warn\b' && ! echo "$NEW_STRING" | grep -qE "console\.warn\([^)]*['\"]Acceptable warning:"; then
    _emit_block "BLOCKED: console.warn without 'Acceptable warning:' prefix — CLAUDE.md Code Style rule. Format: console.warn('Acceptable warning: <message>')."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE 'setBinaural\s*\(\s*([0-7](\.[0-9]+)?|1[3-9]|[2-9][0-9])\b'; then
    _emit_block "BLOCKED: setBinaural called outside alpha range 8–12Hz — Hard Rule (binaural is imperceptible neurostimulation only). Clamp to [8, 12]."
    exit 2
  fi
fi

if echo "$FILE" | grep -qE '/Polychron/src/' && ! _onb_is_graduated; then
  MODULE=$(_extract_module "$FILE")
  TARGET=$(_onb_target)
  if [ -n "$TARGET" ] && [ "$MODULE" != "$TARGET" ]; then
    echo "NEXUS: Editing $MODULE but onboarding target is $TARGET. Proceeding (warning, not a block)." >&2
  fi
fi

_streak_tick 10
if ! _streak_check; then exit 1; fi
exit 0
