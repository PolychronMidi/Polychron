#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_onboarding.sh"
# PostToolUse: Edit — coverage classification + user-facing review reminders.
# activity_log + nexus EDIT tracking moved to proxy middleware
# (tools/HME/proxy/middleware/activity_log.js + nexus_tracking.js).
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
SESSION_ID=$(_safe_jq "$INPUT" '.session_id' 'unknown')
PROJECT="$PROJECT_ROOT"

if echo "$FILE" | grep -qE '/(src|tools/HME/(mcp|chat|activity|hooks|scripts|proxy))/'; then
  MODULE=$(_extract_module "$FILE")
  HME_READ_PRIOR=false
  if _nexus_has BRIEF "$MODULE" || _nexus_has BRIEF "$FILE"; then
    HME_READ_PRIOR=true
  fi
  # Coverage classification still lives here — splits lazy vs productive
  # incoherence based on kb-staleness. Middleware can't tell the two apart
  # without re-parsing staleness, so we keep this in the shell hook.
  if [ "$HME_READ_PRIOR" = "false" ] && _onb_is_graduated; then
    STALENESS_FILE="$PROJECT/metrics/kb-staleness.json"
    COVERAGE_STATUS=UNKNOWN
    if [ -f "$STALENESS_FILE" ]; then
      COVERAGE_STATUS=$(_safe_py3 "
import json, sys
d = json.load(open('$STALENESS_FILE'))
for m in d.get('modules', []):
    if m.get('module') == '$MODULE':
        print(m.get('status','UNKNOWN'))
        break
else:
    print('UNKNOWN')
" "UNKNOWN")
    fi
    case "$COVERAGE_STATUS" in
      MISSING)
        _emit_activity productive_incoherence --session="$SESSION_ID" --file="$FILE" --module="$MODULE" --coverage="$COVERAGE_STATUS" --reason=exploratory_write_into_uncovered_territory
        _emit_activity learn_suggested --session="$SESSION_ID" --file="$FILE" --module="$MODULE" --reason=capture_novel_findings
        ;;
      *)
        _emit_activity coherence_violation --session="$SESSION_ID" --file="$FILE" --module="$MODULE" --coverage="$COVERAGE_STATUS" --reason=write_without_hme_read
        ;;
    esac
  fi

  EDIT_COUNT=$(_nexus_count EDIT)
  if [ "$EDIT_COUNT" -ge 5 ]; then
    echo "NEXUS: ${EDIT_COUNT} files edited since last review. Run review(mode='forget') now — backlog is growing." >&2
  elif [ "$EDIT_COUNT" -ge 3 ]; then
    echo "NEXUS: ${EDIT_COUNT} files edited since last review. Consider review(mode='forget') soon." >&2
  fi

  if ! _onb_is_graduated && [ "$(_onb_state)" = "targeted" ]; then
    _onb_advance_to edited
    echo "NEXUS: onboarding advanced to 'edited'. Next: run review(mode='forget') to audit changes." >&2
  fi
fi

exit 0
