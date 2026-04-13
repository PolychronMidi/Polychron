#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: first HME tool of session — inject agent primer once, then clear flag.
cat > /dev/null  # consume stdin

PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
FLAG="${PROJECT}/tmp/hme-primer-needed.flag"

if [ -f "$FLAG" ]; then
  PRIMER="${PROJECT}/doc/AGENT_PRIMER.md"
  rm -f "$FLAG"
  if [ -f "$PRIMER" ]; then
    CONTENT=$(cat "$PRIMER")
    BOOT_CHECK="━━━ MANDATORY BOOT CHECK — run both now before starting work ━━━
hme_admin(action='selftest')      0 FAILs = tools + index + KB healthy
evolve(focus='invariants')        0 errors = structural coherence holds
If either fails, the output tells you exactly what to fix.
━━━ END BOOT CHECK ━━━"
    jq -n --arg content "$CONTENT" --arg boot "$BOOT_CHECK" \
      '{"hookSpecificOutput":{"permissionDecision":"allow"},"systemMessage":("━━━ AGENT PRIMER (once per session) ━━━\n" + $content + "\n━━━ END PRIMER ━━━\n\n" + $boot)}'
    exit 0
  fi
fi

exit 0
