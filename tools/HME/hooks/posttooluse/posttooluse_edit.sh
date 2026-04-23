#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_onboarding.sh"
# PostToolUse: Edit — coverage classification + user-facing review reminders.
# Nexus EDIT tracking lives in BOTH the proxy middleware (nexus_tracking.js)
# and this shell hook. Middleware covers proxy-routed sessions; the shell
# fallback below covers direct-to-API sessions (VS Code Claude Code) where
# the middleware never sees the tool result. _nexus_add is content-keyed
# so double-tracking is harmless.
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
SESSION_ID=$(_safe_jq "$INPUT" '.session_id' 'unknown')
PROJECT="$PROJECT_ROOT"

# Mirror the middleware's EDIT-tracking gate. Same path-allowlist regex.
if echo "$FILE" | grep -qE '/(src|tools/HME/(mcp|chat|activity|hooks|scripts|proxy))/'; then
  _nexus_add EDIT "$FILE"
fi

# Rebuild dir-intent index on README.md edits — same as posttooluse_write.sh.
if [[ "$FILE" == */README.md ]]; then
  python3 "$PROJECT_ROOT/scripts/pipeline/hme/build-dir-intent-index.py" \
    >/dev/null 2>&1 &
fi

# Bias-registration edits trigger the jurisdiction manifest snapshot in the
# background. `registerTrustBias` / `registerCouplingBias` / `registerJurisdictionBias`
# write into 93 locked bias-bounds; a change to any of them must be reflected
# in scripts/bias-bounds-manifest.json or the hypermeta-jurisdiction check
# fails at lint time. Auto-fire the snapshot so legitimate structural changes
# don't trip CI on the next pipeline run.
NEW_STRING=$(_safe_jq "$INPUT" '.tool_input.new_string' '')
if echo "$FILE" | grep -qE '/Polychron/src/conductor/' \
   && echo "$NEW_STRING" | grep -qE 'conductorIntelligence\.register(Trust|Coupling|Jurisdiction)Bias\b'; then
  _lifesaver_bg "bias_bounds_snapshot" 60 "$PROJECT_ROOT/tmp/hme-bias-bounds-snapshot.out" \
    node "$PROJECT_ROOT/scripts/check-hypermeta-jurisdiction.js" --snapshot-bias-bounds
  echo "[hme] bias registration edited — snapshotting bias-bounds manifest (hme-bias-bounds-snapshot.out)" >&2
fi

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

  # Edit count reminders are owned by the proxy status block — no STDERR here.

  if ! _onb_is_graduated && [ "$(_onb_state)" = "targeted" ]; then
    _onb_advance_to edited
    # Onboarding advance is surfaced by the proxy status block — silent here.
  fi
fi

exit 0
