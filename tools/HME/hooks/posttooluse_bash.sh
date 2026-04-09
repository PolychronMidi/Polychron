#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PostToolUse: Bash — background file tracking + Evolver phase triggers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_tab_helpers.sh"

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Track background task output files to compact tab
BG_FILE=$(echo "$INPUT" | _extract_bg_output_path)
[[ -n "$BG_FILE" ]] && _append_file_to_tab "$BG_FILE"

if echo "$CMD" | grep -q 'npm run main'; then
  # LIFESAVER: Scan pipeline summary for errors in non-fatal steps.
  # These are real failures (Traceback, CUDA OOM, RuntimeError) that the
  # pipeline continued past. They MUST be addressed — not ignored.
  PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
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

!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  PIPELINE ERRORS DETECTED — DO NOT IGNORE
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
$ERROR_STEPS

  These are REAL failures in pipeline steps. You MUST:
  (1) Read the full pipeline output for each failed step
  (2) Diagnose the root cause
  (3) Fix the issue before proceeding with any other work
  DO NOT mark this pipeline run as successful.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

ERRMSG
    fi
  fi
  cat >&2 <<'MSG'
EVOLVER: Pipeline complete. You MUST now:
(1) Read fingerprint-comparison.json
(2) Read trace-summary metrics
(3) Journal the round in metrics/journal.md
(4) index_codebase + add_knowledge for confirmed rounds
Do NOT skip Phases 5-7.
MSG
elif echo "$CMD" | grep -q 'npm run snapshot'; then
  echo 'Baseline captured. Persist any new calibration anchors or decisions to HME add_knowledge.' >&2
elif echo "$CMD" | grep -q 'node lab/run'; then
  echo 'LAB COMPLETE: Check results for FAIL/PASS. Every sketch must render a .wav file. Failed sketches need diagnosis and re-run before reporting verdicts.' >&2
fi
exit 0
