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
    jq -n --arg content "$CONTENT" \
      '{"hookSpecificOutput":{"permissionDecision":"allow"},"systemMessage":("━━━ AGENT PRIMER (once per session) ━━━\n" + $content + "\n━━━ END PRIMER ━━━")}'
    exit 0
  fi
fi

exit 0
