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

# Background-stub resolution: if Bash auto-backgrounded this command, swap
# the "Command running in background with ID: X" stub in .tool_response
# for the real task-output content (short synchronous wait). Every
# sub-hook dispatched below inherits the resolved INPUT, so review /
# hme_read / learn / etc. see real output instead of the stub. The proxy
# middleware background_dominance.js handles the same resolution on the
# API-stream side for the model — two complementary layers.
_RESOLVED=$(printf '%s' "$INPUT" | bash "$SCRIPT_DIR/../helpers/_resolve_bg_stub.sh" 10 "" || true)
[ -n "$_RESOLVED" ] && INPUT="$_RESOLVED"

# Universal enqueue-sentinel scanner. Any tool output containing
#   [enqueue: tier=<easy|medium|hard> text="<one-line>" source="<who>"]
# automatically materializes as a task in tmp/hme-buddy-queue/pending/.
# Lets any HME tool (or any Bash command) declare follow-up work
# without each tool needing its own integration code — symmetric with
# the [no-work] and [picked-difficulty:] sentinels we already use.
# Multiple matches per tool output are all enqueued.
#
# CRITICAL: only fires when an active dispatcher mode is configured.
# Without a drainer, enqueued tasks pile up in pending/ forever (the
# same stack-up class the universal-prune fix closed for done todos).
# Active when EITHER:
#   - BUDDY_SYSTEM=1 (claude-resume drainer)
#   - HME_DISPATCH_MODE=synthesis (synthesis_reasoning drainer)
# When neither holds, the sentinel is observed (logged to stderr for
# transcript evidence) but no task file is written.
_DISP_MODE="${HME_DISPATCH_MODE:-}"
if [ -z "$_DISP_MODE" ]; then
  [ "${BUDDY_SYSTEM:-0}" = "1" ] && _DISP_MODE="claude-resume" || _DISP_MODE="disabled"
fi
if [ "$_DISP_MODE" = "claude-resume" ] || [ "$_DISP_MODE" = "synthesis" ]; then
  _ENQUEUE_OUTPUT=$(_safe_jq "$INPUT" '.tool_response' '')
  if [ -n "$_ENQUEUE_OUTPUT" ] && [ -n "${PROJECT_ROOT:-}" ]; then
    _BUDDY_CLI="$PROJECT_ROOT/i/buddy"
    if [ -x "$_BUDDY_CLI" ]; then
      while IFS= read -r _ENQ_LINE; do
        [ -z "$_ENQ_LINE" ] && continue
        _ENQ_TIER=$(echo "$_ENQ_LINE" | grep -oE 'tier=(easy|medium|hard)' | head -1 | cut -d= -f2)
        _ENQ_TEXT=$(echo "$_ENQ_LINE" | grep -oE 'text="[^"]+"' | head -1 | sed 's/^text="\(.*\)"$/\1/')
        _ENQ_SRC=$(echo "$_ENQ_LINE" | grep -oE 'source="[^"]+"' | head -1 | sed 's/^source="\(.*\)"$/\1/')
        [ -z "$_ENQ_TIER" ] && _ENQ_TIER="medium"
        [ -z "$_ENQ_SRC" ] && _ENQ_SRC="enqueue-sentinel"
        [ -z "$_ENQ_TEXT" ] && continue
        # Background fire — never block the parent hook.
        ("$_BUDDY_CLI" enqueue tier="$_ENQ_TIER" text="$_ENQ_TEXT" source="$_ENQ_SRC" \
          > /dev/null 2>&1) &
        disown 2>/dev/null || true
      done < <(printf '%s\n' "$_ENQUEUE_OUTPUT" | grep -oE '\[enqueue:[^]]+\]')
    fi
  fi
else
  # Surface seen-but-skipped sentinels so the operator knows their
  # follow-up declarations aren't being dropped silently. Avoids the
  # "I emitted [enqueue: ...] but nothing happened" debugging gap.
  _ENQ_PEEK=$(_safe_jq "$INPUT" '.tool_response' '' | grep -oE '\[enqueue:[^]]+\]' | head -3)
  if [ -n "$_ENQ_PEEK" ]; then
    echo "[enqueue-sentinel] dispatch disabled — $(echo "$_ENQ_PEEK" | wc -l) enqueue sentinel(s) seen but not queued. Set BUDDY_SYSTEM=1 (claude-resume) OR HME_DISPATCH_MODE=synthesis (route through HME's synthesis cascade) in .env to activate." >&2
  fi
fi

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
  _signal_emit pipeline_finished posttooluse_bash pipeline "{\"exit_code\":$(_safe_jq "$INPUT" '.tool_result.exit_code // .exit_code // 0' '0')}"
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
  SUMMARY_FILE="$PROJECT/output/metrics/pipeline-summary.json"
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
    PASSED=$(_safe_py3 "import json; d=json.load(open('$PROJECT/output/metrics/pipeline-summary.json')); print(d.get('failed',1))" "1")
    FP="$PROJECT/output/metrics/fingerprint-comparison.json"
    VERDICT=$(_safe_py3 "import json; print(json.load(open('$FP')).get('verdict','UNKNOWN'))" "UNKNOWN")
    WALL_S=$(_safe_py3 "import json; d=json.load(open('$PROJECT/output/metrics/pipeline-summary.json')); print(int(d.get('wallTimeSeconds',0)))" "0")
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

# Nexus: track git commits made via the Bash tool.
# (Auto-fire i/review on commit was MOVED to autocommit-direct.sh — this
# hook only fires when the user manually runs `git commit` via Bash, which
# is rare. Autocommits go through autocommit-direct.sh, which now detects
# HEAD movement post-commit and fires the same review autofire there. So
# review reliably triggers on EVERY commit regardless of how it was made,
# instead of the prior 3-day silent-skip.)
if echo "$CMD" | grep -qE '^git commit'; then
  EXIT_CODE=$(_safe_jq "$INPUT" '.tool_result.exit_code // .exit_code // "0"' '0')
  # Use _safe_jq (fail-loud) for tool_response extraction instead of raw jq
  # with stderr suppressed.
  _PTB_RESPONSE=$(_safe_jq "$INPUT" '.tool_response' '')
  if [ "$EXIT_CODE" = "0" ] || echo "$_PTB_RESPONSE" | grep -q '\[.*\]'; then
    _nexus_mark COMMIT
  fi
fi

exit 0
