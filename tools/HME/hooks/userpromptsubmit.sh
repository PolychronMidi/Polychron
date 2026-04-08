#!/usr/bin/env bash
# HME UserPromptSubmit: inject context on evolution-related prompts
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.user_prompt // ""')

# Detect evolution-related prompts and inject Evolver awareness
if echo "$PROMPT" | grep -qiE 'evolve|evolution|next round|run main|pipeline|lab|sketch'; then
  echo 'EVOLVER CONTEXT: Remember to use before_editing before modifying files, what_did_i_forget after changes, and add_knowledge after confirmed rounds. Check metrics/journal.md for the latest round context.' >&2
fi

# Always: anti-abandonment reminder
echo 'PLAN DISCIPLINE: Finish the current atomic unit before pivoting. Clarify BEFORE starting, not after. Never leave code/tools in a broken intermediate state while switching approach. If user feedback changes direction: finish current unit, explicitly name what was left undone, get confirmation.' >&2

exit 0
