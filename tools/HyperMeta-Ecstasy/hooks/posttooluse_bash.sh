#!/usr/bin/env bash
# HME PostToolUse: Bash — Evolver phase triggers after pipeline/snapshot/lab
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

if echo "$CMD" | grep -q 'npm run main'; then
  cat >&2 <<'MSG'
EVOLVER: Pipeline complete. You MUST now:
(1) Read fingerprint-comparison.json
(2) Read trace-summary metrics
(3) Journal the round in metrics/journal.md
(4) index_codebase + add_knowledge for confirmed rounds
Do NOT skip Phases 5-7.
MSG
elif echo "$CMD" | grep -q 'npm run snapshot'; then
  echo 'Baseline captured. Persist any new calibration anchors or decisions to HyperMeta-Ecstasy add_knowledge.' >&2
elif echo "$CMD" | grep -q 'node lab/run'; then
  echo 'LAB COMPLETE: Check results for FAIL/PASS. Every sketch must render a .wav file. Failed sketches need diagnosis and re-run before reporting verdicts.' >&2
fi
exit 0
