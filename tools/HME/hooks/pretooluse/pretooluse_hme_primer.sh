#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_onboarding.sh"
# HME PreToolUse: first HME tool of session — inject walkthrough-shaped primer once.
cat > /dev/null  # consume stdin

PROJECT="$PROJECT_ROOT"
FLAG="${PROJECT}/tmp/hme-primer-needed.flag"

if [ -f "$FLAG" ]; then
  PRIMER="${PROJECT}/doc/AGENT_PRIMER.md"
  rm -f "$FLAG"

  # H14: Agent fingerprint — read the model ID from env if Claude Code sets
  # it, else from the last assistant message in the transcript. Different
  # agents get different walkthrough depth:
  #   opus*    → full walkthrough (context-rich)
  #   sonnet*  → medium walkthrough
  #   haiku*   → terse walkthrough (context-sensitive)
  #   local*   → KB-heavy walkthrough with coupling hints
  AGENT_FINGERPRINT="${CLAUDE_MODEL_ID:-unknown}"
  case "$AGENT_FINGERPRINT" in
    *opus*|claude-opus*)   AGENT_TIER="rich" ;;
    *sonnet*|claude-sonnet*) AGENT_TIER="medium" ;;
    *haiku*|claude-haiku*) AGENT_TIER="terse" ;;
    *)                     AGENT_TIER="medium" ;;
  esac
  # Persist fingerprint so other hooks can consult it
  mkdir -p "${PROJECT}/tmp"
  echo "$AGENT_FINGERPRINT" > "${PROJECT}/tmp/hme-agent-fingerprint.txt"
  echo "$AGENT_TIER" > "${PROJECT}/tmp/hme-agent-tier.txt"
  if [ -f "$PRIMER" ]; then
    CONTENT=$(cat "$PRIMER")
    CUR_STEP=$(_onb_step_label)

    # H6: surface coupling matrix data from prior sessions as an effectiveness
    # hint. Reads metrics/hme-coupling.json and picks the top 3 tool pairs
    # that historically led to clean sessions. This makes the dormant coupling
    # data load-bearing — agents see "these sequences tend to work."
    COUPLING_HINT=""
    COUPLING_FILE="$PROJECT/metrics/hme-coupling.json"
    if [ -f "$COUPLING_FILE" ]; then
      COUPLING_HINT=$(python3 <<'PYEOF' 2>/dev/null
import json
try:
    d = json.load(open('metrics/hme-coupling.json'))
    matrix = d.get('matrix', {})
    # Find pairs with high lift (co-occurrence correlates with clean sessions)
    pairs = []
    for a, row in matrix.items():
        for b, info in row.items():
            lift = info.get('lift', 0)
            coo = info.get('cooccurrence', 0)
            if coo >= 2 and lift >= 1.2:
                pairs.append((a, b, lift, coo))
    pairs.sort(key=lambda x: -x[2])
    if pairs:
        print('Historically effective tool pairs (from session history):')
        for a, b, lift, coo in pairs[:3]:
            print(f'  - {a} → {b}  (lift={lift:.2f}, co-occurrence={coo} sessions)')
except Exception:
    pass
PYEOF
)
    fi
    [ -n "$COUPLING_HINT" ] && COUPLING_HINT=$'\n\n'"$COUPLING_HINT"
    # Walkthrough content tier-selected by agent fingerprint (H14)
    case "$AGENT_TIER" in
      terse)
        WALKTHROUGH="━━━ ONBOARDING — step: ${CUR_STEP} ━━━
Loop: selftest → evolve(design) → Edit → review(forget) → npm run main → STABLE → learn()
Hooks auto-advance. Out-of-order tools get redirected. Notice HME issues → report in learn() content."
        ;;
      rich|medium|*)
        WALKTHROUGH="━━━ ONBOARDING ACTIVE — current step: ${CUR_STEP} ━━━
The HME chain decider runs prerequisites silently inside tool handlers.
Hooks advance state automatically as you make tool calls. Out-of-order tools
get a one-line redirect; no retry dance.

One full loop — composition evolution AND HME self-monitoring in a single pass:
  1. hme_admin(action='selftest')            → boot check, advances to selftest_ok
  2. evolve(focus='design')                  → picks target module, advances to targeted
  3. Edit on target module                   → KB briefing auto-chains via the
                                                pretooluse_edit hook (KB constraints
                                                appear as systemMessage before edit
                                                runs); advances to edited
  4. review(mode='forget')                   → clean = advances to reviewed
  5. Bash npm run main (run_in_background)   → advances to piped
  6. STABLE/EVOLVED verdict                  → advances to verified
  7. learn(title=, content=)                 → graduates

While editing, if you notice anything about HME ITSELF (stale KB entries, wrong
constraints, missing hook coverage, broken enforcement), add an 'HME
observations' section to your learn() content at step 7. Composition is the
carrier wave; self-monitoring rides along in the same loop.

[agent tier: ${AGENT_TIER}, fingerprint: ${AGENT_FINGERPRINT}]"
        ;;
    esac
    jq -n --arg content "$CONTENT" --arg walk "$WALKTHROUGH" --arg coupling "$COUPLING_HINT" \
      '{"hookSpecificOutput":{"permissionDecision":"allow"},"systemMessage":("━━━ AGENT PRIMER (once per session) ━━━\n" + $content + "\n━━━ END PRIMER ━━━\n\n" + $walk + $coupling)}'
    exit 0
  fi
fi

exit 0
