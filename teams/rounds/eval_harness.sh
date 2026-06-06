#!/usr/bin/env bash
# C1/C2 evaluation harness: run the measured baseline-vs-mesh round with the
# calibrated claim-audit layer OFF and ON, score each, and emit a comparison so
set -uo pipefail
REPO="${PROJECT_ROOT:?PROJECT_ROOT required}"; cd "$REPO"
CAP="${CAPSULE:?CAPSULE required (path to a Context Capsule)}"
RUNNER="$REPO/teams/rounds/round_measured.sh"
SCORER="$REPO/teams/rounds/score_round.py"
OUT="$REPO/teams/runtime/output"
EVAL="$REPO/teams/runtime/eval/${1:-$(date +%s)}"
mkdir -p "$EVAL/off" "$EVAL/on"

run_arm() { # claim_audit_value arm_dir label
  CLAIM_AUDIT="$1" CAPSULE="$CAP" PROJECT_ROOT="$REPO" bash "$RUNNER" >/dev/null 2>&1 || true
  cp -f "$OUT"/m_base.json "$OUT"/m_red.json "$OUT"/m_redp.json "$OUT"/m_cross.json "$2"/ 2>/dev/null || true
  python3 "$SCORER" "$2" --label "$3" > "$2/scorecard.json" 2>/dev/null || true
}

echo "[eval] arm 1/2: claim-audit OFF"
run_arm 0 "$EVAL/off" "claim-audit-off"
echo "[eval] arm 2/2: claim-audit ON"
run_arm 1 "$EVAL/on" "claim-audit-on"

python3 "$SCORER" --compare "$EVAL/off/scorecard.json" "$EVAL/on/scorecard.json" > "$EVAL/comparison.json" 2>/dev/null || true
echo "[eval] wrote: $EVAL/{off,on}/scorecard.json and comparison.json"
cat "$EVAL/comparison.json" 2>/dev/null || echo "[eval] comparison unavailable"
