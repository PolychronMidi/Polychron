#!/usr/bin/env bash
# HME UserPromptSubmit: inject context on evolution-related prompts
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.user_prompt // ""')

# ── LIFESAVER — HME Error Log Monitor ───────────────────────────────────────
# LIFE-OR-DEATH: The HME Chat panel writes errors to log/hme-errors.log.
# THIS is the ONLY mechanism that makes those errors visible to this agent.
# Every error, everywhere, MUST be diagnosed and FIXED. Not acknowledged — FIXED.
# An error that is seen and not fixed is WORSE than an unseen error.
PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
ERROR_LOG="$PROJECT/log/hme-errors.log"
WATERMARK="$PROJECT/tmp/hme-errors.lastread"
TURNSTART="$PROJECT/tmp/hme-errors.turnstart"

mkdir -p "$PROJECT/tmp"

if [ -f "$ERROR_LOG" ]; then
  TOTAL=$(wc -l < "$ERROR_LOG" 2>/dev/null || echo 0)
  LAST=0
  [ -f "$WATERMARK" ] && LAST=$(cat "$WATERMARK" 2>/dev/null || echo 0)

  # Record turn start line count (Stop hook uses this to catch mid-turn errors)
  echo "$TOTAL" > "$TURNSTART"

  if [ "$TOTAL" -gt "$LAST" ]; then
    NEW_ERRORS=$(awk "NR > $LAST" "$ERROR_LOG" | sort -u)
    # DO NOT advance watermark here — Stop hook is the only gate that advances it.
    # If watermark advanced here, unfixed errors vanish when Stop sees TOTAL==TURNSTART.
    echo "" >&2
    echo "╔════════════════════════════════════════════════════════════════════════╗" >&2
    echo "║  🚨 LIFESAVER — ERRORS DETECTED — FIX BEFORE ANYTHING ELSE 🚨         ║" >&2
    echo "║  Acknowledging an error without fixing it is a CRITICAL VIOLATION.     ║" >&2
    echo "║  You MUST: 1) diagnose root cause  2) implement fix  3) verify fix     ║" >&2
    echo "╚════════════════════════════════════════════════════════════════════════╝" >&2
    echo "$NEW_ERRORS" >&2
    echo "" >&2
    echo "DO NOT proceed with any other task until every error above is FIXED." >&2
    echo "" >&2
  fi
fi

# Detect evolution-related prompts and inject Evolver awareness
if echo "$PROMPT" | grep -qiE 'evolve|evolution|next round|run main|pipeline|lab|sketch'; then
  echo 'EVOLVER CONTEXT: Remember to use before_editing before modifying files, what_did_i_forget after changes, and add_knowledge after confirmed rounds. Check metrics/journal.md for the latest round context.' >&2
fi

# Always: anti-abandonment reminder
echo 'PLAN DISCIPLINE: Finish the current atomic unit before pivoting. Clarify BEFORE starting, not after. Never leave code/tools in a broken intermediate state while switching approach. If user feedback changes direction: finish current unit, explicitly name what was left undone, get confirmation.' >&2

exit 0
