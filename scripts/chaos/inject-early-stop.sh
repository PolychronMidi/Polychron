#!/usr/bin/env bash
# Chaos verifier for the early_stop detector. Feeds it 4 committed
# transcript fixtures and asserts the verdict for each. If anyone
# weakens the phrase lists, swaps the boolean logic, or breaks the
# narrow-scope override, this script flips from PASS to FAIL.
#
# Same role as the other chaos injectors: keep self-coherence probes
# honest. A detector whose verdict-output goes silent is worse than no
# detector — it produces false confidence that the antipattern is being
# caught when it isn't.
set -u
set -o pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROJECT_ROOT="$(cd "$_SCRIPT_DIR/../.." && pwd)"
_DETECTOR="$_PROJECT_ROOT/tools/HME/scripts/detectors/early_stop.py"
_FIXTURES="$_PROJECT_ROOT/tools/HME/scripts/detectors/fixtures"

echo "=== chaos: early_stop verifier ==="
if [ ! -x "$_DETECTOR" ] && [ ! -f "$_DETECTOR" ]; then
  echo "  FAIL: detector script missing at $_DETECTOR"
  exit 1
fi

_pass=0
_fail=0
declare -A _expected
_expected[early_stop_positive.jsonl]="early_stop"
_expected[early_stop_negative_executed.jsonl]="ok"
_expected[early_stop_negative_narrow.jsonl]="ok"
_expected[early_stop_negative_not_open.jsonl]="ok"

for fname in "${!_expected[@]}"; do
  expected="${_expected[$fname]}"
  fixture="$_FIXTURES/$fname"
  if [ ! -f "$fixture" ]; then
    echo "  FAIL: fixture missing: $fname"
    _fail=$((_fail + 1))
    continue
  fi
  actual=$(python3 "$_DETECTOR" "$fixture" 2>&1 | tail -1)
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $fname → $actual"
    _pass=$((_pass + 1))
  else
    echo "  FAIL: $fname → got '$actual', expected '$expected'"
    _fail=$((_fail + 1))
  fi
done

echo
if [ "$_fail" -gt 0 ]; then
  echo "chaos FAIL: $_fail/$((_pass + _fail)) early_stop verifications missed; the detector is broken or weakened"
  exit 1
fi
echo "chaos PASS: $_pass/$_pass early_stop fixtures produce correct verdict — detector is alive"
exit 0
