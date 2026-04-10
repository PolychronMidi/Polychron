#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PostToolUse: Bash — background file tracking + Evolver phase triggers + nexus state
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_tab_helpers.sh"
source "$SCRIPT_DIR/_nexus.sh"

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

# Nexus: track pipeline verdicts
if echo "$CMD" | grep -q 'npm run main'; then
  RESULT=$(echo "$INPUT" | jq -r '.tool_response // ""' 2>/dev/null | tail -c 500)
  if echo "$RESULT" | grep -q 'Pipeline finished'; then
    PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
    PASSED=$(_safe_py3 "import json; d=json.load(open('$PROJECT/metrics/pipeline-summary.json')); print(d.get('failed',1))" "1")
    FP="$PROJECT/metrics/fingerprint-comparison.json"
    VERDICT=$(_safe_py3 "import json; print(json.load(open('$FP')).get('verdict','UNKNOWN'))" "UNKNOWN")
    if [ "$PASSED" = "0" ]; then
      _nexus_mark PIPELINE "$VERDICT"
      _nexus_clear_type COMMIT
      if [ "$VERDICT" = "STABLE" ] || [ "$VERDICT" = "EVOLVED" ]; then
        echo "NEXUS: Pipeline $VERDICT — commit all changed files now." >&2
      elif [ "$VERDICT" = "DRIFTED" ]; then
        echo "NEXUS: Pipeline DRIFTED — do NOT commit. Diagnose regression." >&2
      fi
    else
      _nexus_mark PIPELINE "FAILED"
      echo "NEXUS: Pipeline FAILED — diagnose with find(error_text, mode='diagnose')." >&2
    fi
  fi
fi

# Nexus: track git commits
if echo "$CMD" | grep -qE '^git commit'; then
  EXIT_CODE=$(echo "$INPUT" | jq -r '.tool_result.exit_code // .exit_code // "0"' 2>/dev/null)
  if [ "$EXIT_CODE" = "0" ] || echo "$INPUT" | jq -r '.tool_response // ""' 2>/dev/null | grep -q '\[.*\]'; then
    _nexus_mark COMMIT
    echo "NEXUS: Committed. Next: check doc sync (review mode='docs') and reindex (hme_admin action='index')." >&2
  fi
fi

exit 0
