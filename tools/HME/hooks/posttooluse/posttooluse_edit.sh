#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_onboarding.sh"
# PostToolUse: Edit — track edited files, remind about review when backlog grows.
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
SESSION_ID=$(_safe_jq "$INPUT" '.session_id' 'unknown')
PROJECT="$PROJECT_ROOT"

# Only track src/ and tools/HME/ edits (not docs, configs, etc.)
if echo "$FILE" | grep -qE '/(src|tools/HME/(mcp|chat|activity|hooks|scripts))/'; then
  MODULE=$(_extract_module "$FILE")
  # Did HME read() run before this edit for the same module? The nexus BRIEF
  # marker is set by read_unified when mode='before'; if present, coherence holds.
  HME_READ_PRIOR=false
  if _nexus_has BRIEF "$MODULE" || _nexus_has BRIEF "$FILE"; then
    HME_READ_PRIOR=true
  fi
  _emit_activity file_written --session="$SESSION_ID" --file="$FILE" --module="$MODULE" --hme_read_prior="$HME_READ_PRIOR"
  if [ "$HME_READ_PRIOR" = "false" ] && _onb_is_graduated; then
    # Phase 3.2: split coherence_violation into lazy vs productive. Lazy =
    # KB has coverage but the agent skipped read. Productive = KB has no
    # coverage yet, so there was nothing meaningful to read first — this is
    # exploratory territory and should be rewarded, not penalized.
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
        # Exploratory: no KB coverage → productive, not lazy
        _emit_activity productive_incoherence --session="$SESSION_ID" --file="$FILE" --module="$MODULE" --coverage="$COVERAGE_STATUS" --reason=exploratory_write_into_uncovered_territory
        _emit_activity learn_suggested --session="$SESSION_ID" --file="$FILE" --module="$MODULE" --reason=capture_novel_findings
        ;;
      *)
        # FRESH / STALE / UNKNOWN — treat as lazy violation
        _emit_activity coherence_violation --session="$SESSION_ID" --file="$FILE" --module="$MODULE" --coverage="$COVERAGE_STATUS" --reason=write_without_hme_read
        ;;
    esac
  fi
  _nexus_add EDIT "$FILE"
  EDIT_COUNT=$(_nexus_count EDIT)
  if [ "$EDIT_COUNT" -ge 5 ]; then
    echo "NEXUS: ${EDIT_COUNT} files edited since last review. Run review(mode='forget') now — backlog is growing." >&2
  elif [ "$EDIT_COUNT" -ge 3 ]; then
    echo "NEXUS: ${EDIT_COUNT} files edited since last review. Consider review(mode='forget') soon." >&2
  fi

  # Onboarding: advance targeted -> edited on first successful src/ edit.
  # Briefing is auto-chained via pretooluse_edit.sh's _hme_validate call, so
  # there's no separate 'briefed' state — the agent goes targeted → edited
  # in one step.
  if ! _onb_is_graduated && [ "$(_onb_state)" = "targeted" ]; then
    _onb_advance_to edited
    echo "NEXUS: onboarding advanced to 'edited'. Next: run review(mode='forget') to audit changes." >&2
  fi
fi

# Reset streak counter — Edit PostToolUse means an HME-adjacent action happened
# (the PreToolUse already incremented; this doesn't interfere)
exit 0
