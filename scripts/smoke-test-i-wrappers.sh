#!/usr/bin/env bash
# Smoke test for the i/ wrapper surface + regression checklist.
# Runs every tool, checks every invariant from the MCP-decoupling refactor,
# and validates the review verdict branches.
#
# Exit status: 0 if all checks pass, 1 on any failure. Every failure is
# printed with the exact command and output.
#
# Usage: scripts/smoke-test-i-wrappers.sh [--verbose]
#        VERBOSE=1 scripts/smoke-test-i-wrappers.sh
set -uo pipefail

VERBOSE="${VERBOSE:-0}"
for arg in "$@"; do [ "$arg" = "--verbose" ] && VERBOSE=1; done

# Resolve project root from this script's location (works from anywhere).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

PASS=0
FAIL=0
FAILURES=()

# helpers
_ok() {
  PASS=$((PASS + 1))
  [ "$VERBOSE" = "1" ] && echo "  PASS: $1"
}
_fail() {
  FAIL=$((FAIL + 1))
  FAILURES+=("$1")
  echo "  FAIL: $1"
}
_section() { echo; echo "== $1 =="; }

# section 1: regression checklist
_section "Regression checklist"

# KB dir populated
if [ -d tools/HME/KB ] && ls tools/HME/KB/*.lance >/dev/null 2>&1; then
  _ok "tools/HME/KB has lance tables"
else
  _fail "tools/HME/KB missing or has no lance tables"
fi

# todos.json ≥ 8 entries
if [ -f tools/HME/KB/todos.json ]; then
  TODO_COUNT=$(python3 -c 'import json; d=json.load(open("tools/HME/KB/todos.json")); print(len(d) if isinstance(d,list) else len(d.get("todos",[])))' 2>/dev/null || echo 0)
  if [ "$TODO_COUNT" -ge 8 ]; then
    _ok "todos.json has ≥8 entries ($TODO_COUNT)"
  else
    _fail "todos.json has $TODO_COUNT entries (expected ≥8)"
  fi
else
  _fail "tools/HME/KB/todos.json missing"
fi

# No non-legacy mcp__HME__ references in hooks/
MCP_REFS=$(grep -rn "mcp__HME__" tools/HME/hooks/ 2>/dev/null | grep -v -E '(^[^:]+:[0-9]+:#|legacy|historical transcripts|mcp__HME__\* )' || true)
if [ -z "$MCP_REFS" ]; then
  _ok "no non-legacy mcp__HME__ references in tools/HME/hooks/"
else
  # Filter further — only fail on active-code references, not comments
  ACTIVE_REFS=$(echo "$MCP_REFS" | grep -v -E '\.sh:[0-9]+:[[:space:]]*#|\.py:[0-9]+:[[:space:]]*#' | grep -v -E "TOOL_NAME.*mcp__HME__|HME_status.*mcp__HME__status" || true)
  if [ -z "$ACTIVE_REFS" ]; then
    _ok "mcp__HME__ references in hooks are legacy-compat only"
  else
    _fail "unexpected mcp__HME__ references in hooks:\n$ACTIVE_REFS"
  fi
fi

# .mcp.json gone, ~/.claude/mcp/HME gone
if [ ! -e .mcp.json ]; then
  _ok ".mcp.json absent"
else
  _fail ".mcp.json still present (should be deleted post-decoupling)"
fi
if [ ! -e "$HOME/.claude/mcp/HME" ]; then
  _ok "~/.claude/mcp/HME absent"
else
  _fail "~/.claude/mcp/HME still present (should be deleted post-decoupling)"
fi

# invariants.json parses
if python3 -c "import json; json.load(open('tools/HME/config/invariants.json'))" 2>/dev/null; then
  _ok "tools/HME/config/invariants.json parses"
else
  _fail "tools/HME/config/invariants.json does not parse as JSON"
fi

# log/ and tmp/ must be at project root; metrics/ must be at output/metrics/ only
ORPHAN_DIRS=$(find . -type d \( -name log -o -name tmp \) \
  -not -path "./log*" -not -path "./tmp*" \
  -not -path "./node_modules/*" -not -path "./.git/*" 2>/dev/null; \
  find . -type d -name metrics \
  -not -path "./output/metrics*" \
  -not -path "./node_modules/*" -not -path "./.git/*" 2>/dev/null)
if [ -z "$ORPHAN_DIRS" ]; then
  _ok "no misplaced log/tmp/metrics directories"
else
  _fail "misplaced log/tmp/metrics dirs found:\n$ORPHAN_DIRS"
fi

# HME_RAG_DB_PATH points at tools/HME/KB
if grep -qE '^HME_RAG_DB_PATH=.*tools/HME/KB' .env 2>/dev/null; then
  _ok ".env HME_RAG_DB_PATH points at tools/HME/KB"
else
  _fail ".env HME_RAG_DB_PATH not pointing at tools/HME/KB"
fi

# section 2: worker health
_section "Worker health"
HEALTH=$(curl -s --max-time 3 http://127.0.0.1:9098/health 2>&1 || echo "")
if echo "$HEALTH" | grep -q '"ready": *true'; then
  _ok "worker /health reports ready"
else
  _fail "worker /health not ready: $HEALTH"
  # If the worker is down, the rest of the smoke tests will cascade fail.
  # Print a summary and bail early rather than spamming the log.
  echo
  echo "Worker unreachable — skipping tool smoke tests. Start the worker and re-run."
  echo
  echo "Summary: $PASS passed, $FAIL failed."
  exit 1
fi

# section 3: 9-tool smoke battery (parallel)
_section "9-tool smoke battery"

# Per-tool check run in the background. Writes result to a temp file keyed
# by a caller-provided slot index so the main loop can tally without races.
# Result format on one line: PASS|label  OR  FAIL|label|detail
_tool_check_bg() {
  local slot="$1" label="$2"
  shift 2
  local out result
  out=$("$@" 2>&1)
  if echo "$out" | head -1 | grep -q '^hme-cli:'; then
    result="FAIL|$label|wrapper transport failure: $(echo "$out" | head -2 | tr '\n' ' ')"
  elif [ -z "$out" ]; then
    result="FAIL|$label|produced no output"
  else
    result="PASS|$label|"
  fi
  printf '%s' "$result" > "$SMOKE_TMP/tool-$slot"
}

# Scratch dir for per-tool result files. Cleaned up on exit.
SMOKE_TMP=$(mktemp -d -t hme-smoke.XXXXXX)
trap 'rm -rf "$SMOKE_TMP"' EXIT

# Launch all nine in parallel. Slots 1..8 are plain tool runs; slot 9 is
# the verbose selftest we also need for the HCI-score checks below.
_tool_check_bg 1 "i/status" ./i/status &
_tool_check_bg 2 "i/review mode=digest" ./i/review mode=digest &
_tool_check_bg 3 "i/trace target=conductorState mode=impact" ./i/trace target=conductorState mode=impact &
_tool_check_bg 4 "i/evolve focus=all" ./i/evolve focus=all &
_tool_check_bg 5 "i/hme-admin action=selftest" ./i/hme-admin action=selftest &
_tool_check_bg 6 "i/todo action=list" ./i/todo action=list &
_tool_check_bg 7 "i/hme-read target=conductorState" ./i/hme-read target=conductorState &
_tool_check_bg 8 "i/hme _mode_pipeline" ./i/hme _mode_pipeline &
# Slot 9 — verbose selftest, reused for HCI/symlink checks.
( ./i/hme-admin action=selftest modules=verbose > "$SMOKE_TMP/selftest-verbose.out" 2>&1 ) &

wait

# Tally slots 1..8.
for slot in 1 2 3 4 5 6 7 8; do
  line=$(cat "$SMOKE_TMP/tool-$slot" 2>/dev/null)
  status="${line%%|*}"
  rest="${line#*|}"
  label="${rest%%|*}"
  detail="${rest#*|}"
  if [ "$status" = "PASS" ]; then _ok "$label"
  else _fail "$label: $detail"
  fi
done

# Slot 9 — parse the verbose selftest output we captured in parallel.
SELFTEST=$(cat "$SMOKE_TMP/selftest-verbose.out" 2>/dev/null)
if echo "$SELFTEST" | grep -qE 'HCI -- [0-9]+/100'; then
  _ok "selftest reports HCI score"
else
  _fail "selftest missing HCI score output"
fi
if echo "$SELFTEST" | grep -qi 'symlink[[:space:]]*--.*FAIL'; then
  _fail "selftest reports symlink FAIL (not updated post-decoupling)"
else
  _ok "selftest has no symlink FAIL"
fi

# section 4: review verdict branches
_section "Review verdict hook branches"

_verdict_check() {
  local verdict="$1"
  local expect_pattern="$2"
  local label="$3"
  local input out
  input=$(jq -n --arg v "$verdict" --arg cmd "i/review mode=forget" \
    '{"tool_input":{"command":$cmd},"tool_response":("## Warnings: none found\n<!-- HME_REVIEW_VERDICT: " + $v + " -->")}')
  out=$(echo "$input" | bash tools/HME/hooks/posttooluse/posttooluse_hme_review.sh 2>&1)
  if echo "$out" | grep -qE "$expect_pattern"; then
    _ok "review verdict=$verdict: $label"
  else
    _fail "review verdict=$verdict: expected /$expect_pattern/ in hook output, got: $out"
  fi
}

_verdict_check "clean" "Ready for pipeline run|Pipeline already passed" "clean path fires next-step hint"
_verdict_check "warnings" "review reported warnings|review issue" "warnings path marks REVIEW_ISSUES"
_verdict_check "error" "review server-side error" "error path marks REVIEW_CLI_FAILURE"

# Drift detection: no marker, no legacy sentinel
DRIFT_INPUT=$(jq -n '{"tool_input":{"command":"i/review mode=forget"},"tool_response":"Some totally unrelated output\nWith no verdict marker at all"}')
DRIFT_OUT=$(echo "$DRIFT_INPUT" | bash tools/HME/hooks/posttooluse/posttooluse_hme_review.sh 2>&1)
if echo "$DRIFT_OUT" | grep -q 'missing canonical HME_REVIEW_VERDICT marker'; then
  _ok "review drift detection fires when neither marker nor legacy sentinel present"
else
  _fail "review drift detection did not fire on unrecognized output: $DRIFT_OUT"
fi

# Empty response should also trigger drift
EMPTY_INPUT=$(jq -n '{"tool_input":{"command":"i/review mode=forget"},"tool_response":""}')
EMPTY_OUT=$(echo "$EMPTY_INPUT" | bash tools/HME/hooks/posttooluse/posttooluse_hme_review.sh 2>&1)
if echo "$EMPTY_OUT" | grep -q 'missing canonical HME_REVIEW_VERDICT marker'; then
  _ok "review drift detection fires on empty response"
else
  _fail "review drift detection did not fire on empty response: $EMPTY_OUT"
fi

# section 5: auto-correct branches
_section "pretooluse_bash i/ auto-correct branches"

_correct_check() {
  local label="$1"
  local input_cmd="$2"
  local extra_input="${3:-}"
  local expect_contains="$4"
  local input
  if [ -n "$extra_input" ]; then
    input=$(jq -n --arg cmd "$input_cmd" --arg extra "$extra_input" \
      'fromjson | .tool_input.command = $cmd' 2>/dev/null \
      || jq -n --arg cmd "$input_cmd" --argjson extra "$extra_input" '{"tool_input":($extra + {"command":$cmd})}')
  else
    input=$(jq -n --arg cmd "$input_cmd" '{"tool_input":{"command":$cmd}}')
  fi
  local out
  out=$(echo "$input" | bash tools/HME/hooks/pretooluse/pretooluse_bash.sh 2>&1)
  if echo "$out" | grep -qF "$expect_contains"; then
    _ok "auto-correct: $label"
  else
    _fail "auto-correct $label: expected containing '$expect_contains', got: $out"
  fi
}

# Inline cd && i/tool
_correct_check "inline cd && i/status rewrites to absolute" \
  "cd tools/HME/chat && i/status" "" \
  "/home/jah/Polychron/i/status"

# tool_input.cwd to subdir
INPUT=$(jq -n '{"tool_input":{"command":"i/status","cwd":"/home/jah/Polychron/tools/HME/chat"}}')
OUT=$(echo "$INPUT" | bash tools/HME/hooks/pretooluse/pretooluse_bash.sh 2>&1)
if echo "$OUT" | grep -qF "/home/jah/Polychron/i/status"; then
  _ok "auto-correct: tool_input.cwd to subdir rewrites"
else
  _fail "auto-correct tool_input.cwd: expected rewrite, got: $OUT"
fi

# Plain i/status at root should NOT rewrite
INPUT=$(jq -n '{"tool_input":{"command":"i/status"}}')
OUT=$(echo "$INPUT" | bash tools/HME/hooks/pretooluse/pretooluse_bash.sh 2>&1)
if echo "$OUT" | grep -qF "auto-corrected"; then
  _fail "auto-correct: plain i/status at root should NOT rewrite, but did: $OUT"
else
  _ok "auto-correct: plain i/status at root is left alone"
fi

# summary
_section "Summary"
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Failures:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
exit 0
