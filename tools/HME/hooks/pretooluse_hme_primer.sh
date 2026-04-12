#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: first HME tool of session — inject agent primer once, then clear flag.
cat > /dev/null  # consume stdin

PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
FLAG="${PROJECT}/tmp/hme-primer-needed.flag"

if [ -f "$FLAG" ]; then
  PRIMER="${PROJECT}/doc/AGENT_PRIMER.md"
  if [ -f "$PRIMER" ]; then
    echo "━━━ AGENT PRIMER (injected once per session) ━━━" >&2
    cat "$PRIMER" >&2
    echo "━━━ END PRIMER ━━━" >&2
  fi
  rm -f "$FLAG"
fi

exit 0
