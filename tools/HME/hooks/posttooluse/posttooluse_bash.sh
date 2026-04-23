#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME PostToolUse: Bash — background file tracking + Evolver phase triggers + nexus state
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../helpers/_tab_helpers.sh"
source "$SCRIPT_DIR/../helpers/_nexus.sh"
source "$SCRIPT_DIR/../helpers/_onboarding.sh"

INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')

# Track background task output files to compact tab
BG_FILE=$(echo "$INPUT" | _extract_bg_output_path)
[[ -n "$BG_FILE" ]] && _append_file_to_tab "$BG_FILE"

# Dispatch HME shell-wrapper post-processors. These used to be triggered via
# hooks.json matchers on mcp__HME__{learn,read,review} back when HME was an
# MCP server; now HME tools run as Bash(i/<tool>) shell wrappers and the
# dispatch happens here. Each handler reads stdin (the same hook JSON) and
# returns additionalContext / systemMessage / permissionDecisionReason.
if echo "$CMD" | grep -qE '(^|[[:space:]/])i/learn\b|scripts/hme-cli\.js learn\b'; then
  echo "$INPUT" | bash "$SCRIPT_DIR/posttooluse_addknowledge.sh" || true
fi
if echo "$CMD" | grep -qE '(^|[[:space:]/])i/hme-read\b|scripts/hme-cli\.js read\b'; then
  echo "$INPUT" | bash "$SCRIPT_DIR/posttooluse_hme_read.sh" || true
fi
if echo "$CMD" | grep -qE '(^|[[:space:]/])i/review\b|scripts/hme-cli\.js review\b'; then
  echo "$INPUT" | bash "$SCRIPT_DIR/posttooluse_hme_review.sh" || true
fi

if echo "$CMD" | grep -q 'npm run main'; then
  # ANTI-STOP: when the pipeline fails at lint/typecheck, diagnose and fix without pausing.
  # Stopping after a failure — asking, summarizing, or waiting — is the psychopathic antipattern.
  # Review warnings are NEVER ignorable: fix every one before proceeding.
  EXIT_CODE_CHECK=$(_safe_jq "$INPUT" '.tool_result.exit_code // .exit_code // "0"' '0')
  if [ "$EXIT_CODE_CHECK" != "0" ]; then
    # Extract the first ERROR line from tool_response for the diagnose hint so
    # the agent has a concrete query to paste into i/trace. Fall back to a
    # generic hint if no error line is surfacable.
    _FIRST_ERR=$(_safe_jq "$INPUT" '.tool_response' '' \
      | grep -iE '^[^#]*(error|exception|failed|traceback):' \
      | head -1 | sed 's/^[[:space:]]*//' | cut -c1-180)
    cat >&2 <<ANTIMSG

  PIPELINE FAILED — DO NOT STOP — FIX IT NOW
  Stopping, summarizing, or asking what to do next is the psychopathic antipattern.
  Read the error above, diagnose the root cause, fix it, rerun. No pausing.
  Review warnings are never "pre-existing" — fix every one in the review output.

  Diagnose via HME: i/trace target="${_FIRST_ERR:-<paste error text>}" mode=diagnose
  (Pulls source trace + similar historical bugs from KB for this failure class.)

ANTIMSG
  fi
  # Onboarding: reviewed -> piped the moment npm run main is launched
  if ! _onb_is_graduated && [ "$(_onb_state)" = "reviewed" ]; then
    _onb_advance_to piped
  fi
  # LIFESAVER: Scan pipeline summary for errors in non-fatal steps.
  # These are real failures (Traceback, CUDA OOM, RuntimeError) that the
  # pipeline continued past. They MUST be addressed — not ignored.
  PROJECT="$PROJECT_ROOT"
  SUMMARY_FILE="$PROJECT/metrics/pipeline-summary.json"
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


  PIPELINE ERRORS DETECTED — DO NOT IGNORE

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
  # chain-snapshot, tool-effectiveness, trajectory, coupling matrix,
  # memetic-drift, verifier-coverage) now live in main-pipeline.js itself.
  # That makes them agent-independent: shell, CI, cron, or any other agent
  # running `npm run main` gets the same side-effects the hook-gated path
  # used to provide. Hook only echoes the terminal summary now.
  PIPELINE_VERDICT=$(_safe_py3 "import json; print(json.load(open('$SUMMARY_FILE')).get('verdict','?'))" '?')
  PIPELINE_WALL=$(_safe_py3 "import json; d=json.load(open('$SUMMARY_FILE')); w=d.get('wallTimeSeconds',0); print(f'{w:.0f}s' if w else '')" '')
  PIPELINE_HCI=$(_safe_py3 "import json; d=json.load(open('$SUMMARY_FILE')); print(d.get('hci','') or '')" '')
  echo "Pipeline ${PIPELINE_VERDICT}${PIPELINE_WALL:+ (${PIPELINE_WALL})}${PIPELINE_HCI:+ | HCI ${PIPELINE_HCI}/100}" >&2
elif echo "$CMD" | grep -q 'npm run snapshot'; then
  echo 'Baseline captured. Persist any new calibration anchors or decisions to HME add_knowledge.' >&2
elif echo "$CMD" | grep -q 'node lab/run'; then
  echo 'LAB COMPLETE: Check results for FAIL/PASS. Every sketch must render a .wav file. Failed sketches need diagnosis and re-run before reporting verdicts.' >&2
fi

# Nexus: track pipeline verdicts
if echo "$CMD" | grep -q 'npm run main'; then
  RESULT=$(_safe_jq "$INPUT" '.tool_response' '' | tail -c 500)
  if echo "$RESULT" | grep -q 'Pipeline finished'; then
    PROJECT="$PROJECT_ROOT"
    SESSION_ID=$(_safe_jq "$INPUT" '.session_id' 'unknown')
    PASSED=$(_safe_py3 "import json; d=json.load(open('$PROJECT/metrics/pipeline-summary.json')); print(d.get('failed',1))" "1")
    FP="$PROJECT/metrics/fingerprint-comparison.json"
    VERDICT=$(_safe_py3 "import json; print(json.load(open('$FP')).get('verdict','UNKNOWN'))" "UNKNOWN")
    WALL_S=$(_safe_py3 "import json; d=json.load(open('$PROJECT/metrics/pipeline-summary.json')); print(int(d.get('wallTimeSeconds',0)))" "0")
    # pipeline_run + round_complete + HCI are all emitted by main-pipeline.js
    # itself — agent-independent observability. The hook no longer needs to
    # re-emit. It still owns nexus + onboarding state advancement below
    # because those are tied to Claude's Bash-tool invocation context.
    if [ "$PASSED" = "0" ]; then
      _nexus_mark PIPELINE "$VERDICT"
      _nexus_clear_type COMMIT
      if [ "$VERDICT" = "STABLE" ] || [ "$VERDICT" = "EVOLVED" ]; then
        if ! _onb_is_graduated; then
          _onb_advance_to verified
        fi
      fi
    else
      _nexus_mark PIPELINE "FAILED"
    fi
  fi
fi

# Nexus: track git commits
if echo "$CMD" | grep -qE '^git commit'; then
  EXIT_CODE=$(_safe_jq "$INPUT" '.tool_result.exit_code // .exit_code // "0"' '0')
  if [ "$EXIT_CODE" = "0" ] || echo "$INPUT" | jq -r '.tool_response // ""' 2>/dev/null | grep -q '\[.*\]'; then
    _nexus_mark COMMIT
    # R32: auto-fire i/review mode=forget after src/ auto-commits.
    # R30 had three catastrophic sins (30s timeout, `|| true` swallowing
    # failures, no LIFESAVER surfacing). _lifesaver_bg (added R32 to
    # _safety.sh) fixes all three by construction. Gate on src/ changes
    # keeps cost aligned with value: doc/substrate commits skip the review.
    if [[ -x "$PROJECT_ROOT/i/review" ]]; then
      # Widened from ^src/ → code+tooling scope. tools/HME/ (hooks, proxy,
      # mcp, chat) and scripts/ edits are real engineering that must be
      # reviewed against KB constraints just like src/ edits. Pure doc/
      # log/ metrics/ tmp/ commits still skip — noise gate intact.
      if git -C "$PROJECT_ROOT" diff --name-only HEAD~1 HEAD 2>/dev/null | grep -qE '^(src|tools/HME|scripts|lab)/'; then
        _lifesaver_bg "review_auto_fire" 600 "$PROJECT_ROOT/tmp/hme-review-auto.out" \
          "$PROJECT_ROOT/i/review" mode=forget
      fi
    fi
  fi
fi

exit 0
