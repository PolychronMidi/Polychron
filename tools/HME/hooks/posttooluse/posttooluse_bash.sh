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

if echo "$CMD" | grep -q 'npm run main'; then
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
  PIPELINE_VERDICT=$(_safe_py3 "import json; print(json.load(open('$SUMMARY_FILE')).get('verdict','?'))" '?')
  PIPELINE_WALL=$(_safe_py3 "import json; d=json.load(open('$SUMMARY_FILE')); w=d.get('wallTimeSeconds',0); print(f'{w:.0f}s' if w else '')" '')

  # Composition ↔ coherence coupling: compute HCI right now and write it into
  # pipeline-summary.json alongside the music verdict. Two axes converge into
  # one record. Snapshot a holograph for time-series analysis.
  HCI_SCRIPT="$PROJECT/tools/HME/scripts/verify-coherence.py"
  HOLO_SCRIPT="$PROJECT/tools/HME/scripts/snapshot-holograph.py"
  PIPELINE_HCI=""
  if [ -f "$HCI_SCRIPT" ]; then
    PIPELINE_HCI=$(PROJECT_ROOT="$PROJECT" python3 "$HCI_SCRIPT" --score 2>/dev/null | tr -d '\n ')
    if [ -n "$PIPELINE_HCI" ]; then
      _safe_py3 "
import json
d = json.load(open('$SUMMARY_FILE'))
d['hci'] = int('$PIPELINE_HCI')
d['hci_captured_at'] = $(date +%s)
json.dump(d, open('$SUMMARY_FILE','w'), indent=2)
print('wrote hci=' + str(d['hci']))
" "" >/dev/null
    fi
  fi
  if [ -f "$HOLO_SCRIPT" ]; then
    PROJECT_ROOT="$PROJECT" python3 "$HOLO_SCRIPT" > /dev/null 2>&1 &
  fi
  # Refresh tool-effectiveness + trajectory + coupling matrix after each pipeline
  # run so the next HCI computation has fresh data to score against.
  EFF_SCRIPT="$PROJECT/tools/HME/scripts/analyze-tool-effectiveness.py"
  TRAJ_SCRIPT="$PROJECT/tools/HME/scripts/analyze-hci-trajectory.py"
  COUPLING_SCRIPT="$PROJECT/tools/HME/scripts/build-hme-coupling-matrix.py"
  [ -f "$EFF_SCRIPT" ] && PROJECT_ROOT="$PROJECT" python3 "$EFF_SCRIPT" > /dev/null 2>&1 &
  [ -f "$TRAJ_SCRIPT" ] && PROJECT_ROOT="$PROJECT" python3 "$TRAJ_SCRIPT" > /dev/null 2>&1 &
  [ -f "$COUPLING_SCRIPT" ] && PROJECT_ROOT="$PROJECT" python3 "$COUPLING_SCRIPT" > /dev/null 2>&1 &
  # H11 (revised): rebuild the interactive HTML dashboard alongside pipeline output
  DASHBOARD_SCRIPT="$PROJECT/tools/HME/scripts/build-dashboard.py"
  [ -f "$DASHBOARD_SCRIPT" ] && PROJECT_ROOT="$PROJECT" python3 "$DASHBOARD_SCRIPT" > /dev/null 2>&1 &
  # H-compact optimization #10: eager chain snapshot after every pipeline run.
  # Pipeline completion is a natural "stable point" — the session has
  # achieved something concrete. Snapshot for free (no LLM, background).
  CHAIN_SNAPSHOT_SCRIPT="$PROJECT/tools/HME/scripts/chain-snapshot.py"
  [ -f "$CHAIN_SNAPSHOT_SCRIPT" ] && PROJECT_ROOT="$PROJECT" python3 "$CHAIN_SNAPSHOT_SCRIPT" --eager > /dev/null 2>&1 &
  # H15: emit HCI as a structured composition-layer signal
  EMIT_SIGNAL="$PROJECT/tools/HME/scripts/emit-hci-signal.py"
  [ -f "$EMIT_SIGNAL" ] && PROJECT_ROOT="$PROJECT" python3 "$EMIT_SIGNAL" > /dev/null 2>&1 &
  # H13: refresh verifier coverage report (cheap)
  COVERAGE_SCRIPT="$PROJECT/tools/HME/scripts/suggest-verifiers.py"
  [ -f "$COVERAGE_SCRIPT" ] && PROJECT_ROOT="$PROJECT" python3 "$COVERAGE_SCRIPT" > /dev/null 2>&1 &
  # H16: refresh memetic drift (cheap)
  MEMETIC_SCRIPT="$PROJECT/tools/HME/scripts/memetic-drift.py"
  [ -f "$MEMETIC_SCRIPT" ] && PROJECT_ROOT="$PROJECT" python3 "$MEMETIC_SCRIPT" > /dev/null 2>&1 &

  cat >&2 <<MSG
EVOLVER: Pipeline ${PIPELINE_VERDICT}${PIPELINE_WALL:+ (${PIPELINE_WALL})}${PIPELINE_HCI:+ | HCI ${PIPELINE_HCI}/100} complete. You MUST now:
(1) Read fingerprint-comparison.json
(2) Read trace-summary metrics
(3) Journal the round in metrics/journal.md
(4) hme_admin(action='index') + learn() for confirmed rounds
(5) Auto-commit if STABLE/EVOLVED (descriptive message, all changed files)
(6) evolve(focus='curate') to prune stale KB entries
(7) Pivot to next evolution target — use HCI delta to ensure HME coherence stayed healthy
MSG
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
    HCI_VAL=$(_safe_py3 "import json; d=json.load(open('$PROJECT/metrics/pipeline-summary.json')); print(d.get('hci','?'))" "?")
    _emit_activity pipeline_run --session="$SESSION_ID" --verdict="$VERDICT" --passed="$PASSED" --wall_s="$WALL_S" --hci="$HCI_VAL"
    if [ "$PASSED" = "0" ]; then
      _nexus_mark PIPELINE "$VERDICT"
      _nexus_clear_type COMMIT
      if [ "$VERDICT" = "STABLE" ] || [ "$VERDICT" = "EVOLVED" ]; then
        echo "NEXUS: Pipeline $VERDICT — commit all changed files now." >&2
        # Onboarding: piped/reviewed -> verified on clean STABLE/EVOLVED
        if ! _onb_is_graduated; then
          _onb_advance_to verified
          echo "NEXUS: onboarding advanced to 'verified'. Next: run learn(title=, content=) to persist the round." >&2
        fi
      elif [ "$VERDICT" = "DRIFTED" ]; then
        echo "NEXUS: Pipeline DRIFTED — do NOT commit. Diagnose regression." >&2
      fi
    else
      _nexus_mark PIPELINE "FAILED"
      echo "NEXUS: Pipeline FAILED — read pipeline output, fix root cause." >&2
    fi
  fi
fi

# Nexus: track git commits
if echo "$CMD" | grep -qE '^git commit'; then
  EXIT_CODE=$(_safe_jq "$INPUT" '.tool_result.exit_code // .exit_code // "0"' '0')
  if [ "$EXIT_CODE" = "0" ] || echo "$INPUT" | jq -r '.tool_response // ""' 2>/dev/null | grep -q '\[.*\]'; then
    _nexus_mark COMMIT
    echo "NEXUS: Committed. Next: hme_admin(action='index') then review(mode='health') for doc sync." >&2
  fi
fi

exit 0
