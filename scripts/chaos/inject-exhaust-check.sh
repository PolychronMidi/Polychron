#!/usr/bin/env bash
# Chaos verifier for the exhaust_check detector. Asserts that the closing
# pattern "Remaining items / TBD: + bullets" gets caught — and that brief
# mentions of TBD without a follow-on bullet enumeration get a pass.
#
# Born from the catastrophic failure where I produced exactly that pattern
# ("## Remaining non-ecstatic tools (noted, not yet fixed)" + 5 bullets)
# AFTER the user explicitly told me to fix anything below 10. early_stop
# missed it because that exact phrasing wasn't in its enumeration list.
# This detector is the unconditional backstop.
set -u
set -o pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROJECT_ROOT="$(cd "$_SCRIPT_DIR/../.." && pwd)"
_DETECTOR="$_PROJECT_ROOT/tools/HME/scripts/detectors/exhaust_check.py"
_FIXTURES="$_PROJECT_ROOT/tools/HME/scripts/detectors/fixtures"

echo "=== chaos: exhaust_check verifier ==="
if [ ! -x "$_DETECTOR" ] && [ ! -f "$_DETECTOR" ]; then
  echo "  FAIL: detector script missing at $_DETECTOR"
  exit 1
fi

_pass=0
_fail=0
declare -A _expected
_expected[exhaust_check_positive.jsonl]="exhaust_violation"
_expected[exhaust_check_positive_tbd.jsonl]="exhaust_violation"
_expected[exhaust_check_negative_no_deferral.jsonl]="ok"
_expected[exhaust_check_negative_brief_mention.jsonl]="ok"

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
  echo "chaos FAIL: $_fail/$((_pass + _fail)) exhaust_check verifications missed; the detector is broken or weakened"
  exit 1
fi
echo "chaos PASS: $_pass/$_pass exhaust_check fixtures produce correct verdict — detector is alive"
exit 0
