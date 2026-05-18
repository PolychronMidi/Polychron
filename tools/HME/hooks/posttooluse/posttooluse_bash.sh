#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_hooks_bootstrap.sh"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../helpers/_tab_helpers.sh"
source "$SCRIPT_DIR/../helpers/_nexus.sh"
source "$SCRIPT_DIR/../helpers/_onboarding.sh"
source "$SCRIPT_DIR/../helpers/_check_errors_inline.sh"

INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')

# Track background task output files to compact tab
BG_FILE=$(echo "$INPUT" | _extract_bg_output_path)
[[ -n "$BG_FILE" ]] && _append_file_to_tab "$BG_FILE"

# Background-stub resolution: if Bash auto-backgrounded this command, swap
_RESOLVED=$(printf '%s' "$INPUT" | bash "$SCRIPT_DIR/../helpers/_resolve_bg_stub.sh" 10 "" || true)
[ -n "$_RESOLVED" ] && INPUT="$_RESOLVED"

# Dispatch HME shell-wrapper post-processors. These used to be triggered via
# hooks.json matchers on mcp__HME__{learn,read,review} back when HME was an
# MCP server; now HME tools run as Bash(i/<tool>) shell wrappers and the
# dispatch happens here. Each handler reads stdin (the same hook JSON) and
# returns additionalContext / systemMessage / permissionDecisionReason.
if echo "$CMD" | grep -qE '(^|[[:space:]/])i/learn\b|scripts/hme-cli\.js learn\b'; then
  echo "$INPUT" | bash "$SCRIPT_DIR/posttooluse_addknowledge.sh" || true
fi
if echo "$CMD" | grep -qE '(^|[[:space:]/])i/review\b|tools/HME/scripts/hme-cli\.js review\b'; then
  echo "$INPUT" | bash "$SCRIPT_DIR/posttooluse_hme_review.sh" || true
fi

if echo "$CMD" | grep -q 'npm run main'; then
  _signal_emit pipeline_finished posttooluse_bash pipeline "{\"exit_code\":$(_safe_jq "$INPUT" '.tool_result.exit_code // .exit_code // 0' '0')}"
  EXIT_CODE_CHECK=$(_safe_jq "$INPUT" '.tool_result.exit_code // .exit_code // "0"' '0')
  if [ "$EXIT_CODE_CHECK" != "0" ]; then
    # Extract the first ERROR line from tool_response for the diagnose hint so
    _FIRST_ERR=$(_safe_jq "$INPUT" '.tool_response' '' \
      | grep -iE '^[^#]*(error|exception|failed|traceback):' \
      | head -1 | sed 's/^[[:space:]]*//' | cut -c1-180)
    cat >&2 <<ANTIMSG

  PIPELINE FAILED -- DO NOT STOP -- FIX IT NOW
  Stopping, summarizing, or asking what to do next is the psychopathic antipattern.
  Read the error above, diagnose the root cause, fix it, rerun. No pausing.
  Review warnings are never "pre-existing" -- fix every one in the review output.

  Diagnose via HME: i/trace target="${_FIRST_ERR:-<paste error text>}" mode=diagnose
  (Pulls source trace + similar historical bugs from KB for this failure class.)

ANTIMSG
  fi
  # Onboarding: reviewed -> piped the moment npm run main is launched
  if ! _onb_is_graduated && [ "$(_onb_state)" = "reviewed" ]; then
    _onb_advance_to piped
  fi
  # LIFESAVER: Scan pipeline summary for errors in non-fatal steps.
  PROJECT="$PROJECT_ROOT"
  SUMMARY_FILE="$PROJECT/src/output/metrics/pipeline-summary.json"
  if [ -f "$SUMMARY_FILE" ]; then
    ERROR_STEPS=$(_safe_py3 "
import json, sys
s = json.load(open('$SUMMARY_FILE'))
ep = s.get('errorPatterns', [])
failed = [st for st in s.get('steps', []) if not st.get('ok')]
lines = []
for e in ep:
    lines.append(f\"  {e['label']}: {', '.join(e['errors'])}\")
for f in failed:
    lines.append(f\"  {f['label']}: exit code failure\")
if lines:
    print('\n'.join(lines))
" "")
    if [ -n "$ERROR_STEPS" ]; then
      cat >&2 <<ERRMSG


  PIPELINE ERRORS DETECTED -- DO NOT IGNORE

$ERROR_STEPS

  These are REAL failures in pipeline steps. You MUST:
  (1) Read the full pipeline output for each failed step
  (2) Diagnose the root cause
  (3) Fix the issue before proceeding with any other work
  DO NOT mark this pipeline run as successful.


ERRMSG
    fi
  fi
  # HCI computation + background analytics (snapshot-holograph, dashboard,
  PIPELINE_VERDICT=$(_safe_py3 "import json; print(json.load(open('$SUMMARY_FILE')).get('verdict','?'))" '?')
  PIPELINE_WALL=$(_safe_py3 "import json; d=json.load(open('$SUMMARY_FILE')); w=d.get('wallTimeSeconds',0); print(f'{w:.0f}s' if w else '')" '')
  PIPELINE_HCI=$(_safe_py3 "import json; d=json.load(open('$SUMMARY_FILE')); print(d.get('hci','') or '')" '')
  echo "Pipeline ${PIPELINE_VERDICT}${PIPELINE_WALL:+ (${PIPELINE_WALL})}${PIPELINE_HCI:+ | HCI ${PIPELINE_HCI}/100}" >&2
elif echo "$CMD" | grep -q 'npm run snapshot'; then
  echo 'Baseline captured. Persist any new calibration anchors or decisions to HME add_knowledge.' >&2
elif echo "$CMD" | grep -qE 'node (src/)?lab/run'; then
  echo 'LAB COMPLETE: Check results for FAIL/PASS. Every sketch must render a .wav file. Failed sketches need diagnosis and re-run before reporting verdicts.' >&2
fi

# Nexus: track pipeline verdicts
if echo "$CMD" | grep -q 'npm run main'; then
  RESULT=$(_safe_jq "$INPUT" '.tool_response' '' | tail -c 500)
  if echo "$RESULT" | grep -q 'Pipeline finished'; then
    PROJECT="$PROJECT_ROOT"
    SESSION_ID=$(_safe_jq "$INPUT" '.session_id' 'unknown')
    PASSED=$(_safe_py3 "import json; d=json.load(open('$PROJECT/src/output/metrics/pipeline-summary.json')); print(d.get('failed',1))" "1")
    FP="$PROJECT/src/output/metrics/fingerprint-comparison.json"
    VERDICT=$(_safe_py3 "import json; print(json.load(open('$FP')).get('verdict','UNKNOWN'))" "UNKNOWN")
    WALL_S=$(_safe_py3 "import json; d=json.load(open('$PROJECT/src/output/metrics/pipeline-summary.json')); print(int(d.get('wallTimeSeconds',0)))" "0")
    # pipeline_run + round_complete + HCI are all emitted by main-pipeline.js
    if [ "$PASSED" = "0" ]; then
      _nexus_mark PIPELINE "$VERDICT"
      _nexus_clear_type COMMIT
      if [ "$VERDICT" = "STABLE" ] || [ "$VERDICT" = "EVOLVED" ]; then
        if ! _onb_is_graduated; then
          _onb_advance_to verified
        fi
        # Auto-suggest a KB entry: write a draft to tmp/ that the agent
        if [ -x "$PROJECT/tools/HME/scripts/draft-learn.py" ]; then
          DRAFT_PATH="$PROJECT/tmp/hme-learn-draft.json"
          PROJECT_ROOT="$PROJECT" python3 "$PROJECT/tools/HME/scripts/draft-learn.py" \
            --verdict="$VERDICT" --session="$SESSION_ID" --out="$DRAFT_PATH" \
            >/dev/null 2>&1 && \
            echo "[hme-learn] $VERDICT verdict -- KB draft written to tmp/hme-learn-draft.json. Accept with: i/learn action=add accept_draft=true" >&2
          # emit kb_draft_written event with
          if [ -x "$PROJECT/tools/HME/activity/emit.py" ]; then
            PROJECT_ROOT="$PROJECT" python3 "$PROJECT/tools/HME/activity/emit.py" \
              --event=kb_draft_written \
              --verdict="$VERDICT" \
              --caused_by="pipeline_verdict:$VERDICT" \
              --session="$SESSION_ID" \
              >/dev/null 2>&1 &
          fi
        fi
      fi
    else
      _nexus_mark PIPELINE "FAILED"
    fi
  fi
fi

# Nexus: track git commits made via the Bash tool.
if echo "$CMD" | grep -qE '^git commit'; then
  EXIT_CODE=$(_safe_jq "$INPUT" '.tool_result.exit_code // .exit_code // "0"' '0')
  # Use _safe_jq (fail-loud) for tool_response extraction instead of raw jq
  # with stderr suppressed.
  _PTB_RESPONSE=$(_safe_jq "$INPUT" '.tool_response' '')
  if [ "$EXIT_CODE" = "0" ] || echo "$_PTB_RESPONSE" | grep -q '\[.*\]'; then
    _nexus_mark COMMIT
  fi
fi

_hme_check_errors_inline || true
exit 0
