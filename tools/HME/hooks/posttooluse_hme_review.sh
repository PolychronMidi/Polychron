#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_nexus.sh"
# PostToolUse: mcp__HME__review — clear edit backlog, point to next step.
INPUT=$(cat)
MODE=$(echo "$INPUT" | jq -r '.tool_input.mode // "digest"')

if [ "$MODE" = "forget" ]; then
  EDIT_COUNT=$(_nexus_count EDIT)
  _nexus_clear_type EDIT
  _nexus_mark REVIEW
  if [ "$EDIT_COUNT" -gt 0 ]; then
    echo "NEXUS: Review complete (${EDIT_COUNT} files audited). Edit backlog cleared." >&2
  fi
  # Point to next step
  if _nexus_has PIPELINE; then
    VERDICT=$(_nexus_get PIPELINE)
    if [ "$VERDICT" = "STABLE" ] || [ "$VERDICT" = "EVOLVED" ]; then
      echo "NEXUS: Pipeline already passed ($VERDICT). Commit if not done yet." >&2
    fi
  else
    echo "NEXUS: Ready for pipeline run (npm run main)." >&2
  fi
fi

# Reset streak counter
echo 0 > /tmp/hme-non-hme-streak.count

exit 0
