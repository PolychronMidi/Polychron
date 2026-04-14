#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_onboarding.sh"
# HME PreToolUse: first HME tool of session — inject walkthrough-shaped primer once.
cat > /dev/null  # consume stdin

PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
FLAG="${PROJECT}/tmp/hme-primer-needed.flag"

if [ -f "$FLAG" ]; then
  PRIMER="${PROJECT}/doc/AGENT_PRIMER.md"
  rm -f "$FLAG"
  if [ -f "$PRIMER" ]; then
    CONTENT=$(cat "$PRIMER")
    CUR_STEP=$(_onb_step_label)
    WALKTHROUGH="━━━ ONBOARDING ACTIVE — current step: ${CUR_STEP} ━━━
The HME chain decider runs prerequisites silently inside tool handlers.
Call the tools listed below in order. Hooks advance state automatically — you
only need to make the next tool call at each step. Out-of-order tools get a
one-line 'use X instead' redirect with no retry dance.

One full loop — composition evolution AND HME self-monitoring in a single pass:
  1. hme_admin(action='selftest')            → boot check, advances to selftest_ok
  2. evolve(focus='design')                  → picks target module, advances to targeted
  3. read(target, mode='before')             → absorbs KB constraints, advances to briefed
  4. Edit on target module                   → hook advances to edited
  5. review(mode='forget')                   → clean = advances to reviewed
  6. Bash npm run main (run_in_background)   → advances to piped
  7. STABLE/EVOLVED verdict                  → advances to verified
  8. learn(title=, content=)                 → graduates

While editing, if you notice anything about HME ITSELF (stale KB entries, wrong
constraints, missing hook coverage, broken enforcement), add an 'HME
observations' section to your learn() content at step 8. Composition is the
carrier wave; self-monitoring rides along in the same loop."
    jq -n --arg content "$CONTENT" --arg walk "$WALKTHROUGH" \
      '{"hookSpecificOutput":{"permissionDecision":"allow"},"systemMessage":("━━━ AGENT PRIMER (once per session) ━━━\n" + $content + "\n━━━ END PRIMER ━━━\n\n" + $walk)}'
    exit 0
  fi
fi

exit 0
