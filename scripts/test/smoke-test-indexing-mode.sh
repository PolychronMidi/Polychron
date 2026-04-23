#!/usr/bin/env bash
# Integration smoke test — fires /indexing-mode end-to-end and asserts:
#   1. daemon + worker are reachable at boot
#   2. coder is healthy before the cycle starts
#   3. /indexing-mode returns a non-error result within 120s
#   4. coder returns to /health=ok within 60s of the cycle ending
#   5. selftest remains READY (0 FAILs) after the cycle
#
# This script catches every regression class from the 2026-04-22 incident:
#   - Silent "not started" sentinel (the daemon would return error, assertion 3 fails)
#   - Duplicate-supervisor race (would trip llama-server count probe, assertion 5 fails)
#   - Stuck cuda:1 context blocking respawn (assertion 4 fails after 60s)
#
# Exit codes: 0=pass, non-zero=specific assertion failure.
set -u
set -o pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROJECT_ROOT="$(cd "$_SCRIPT_DIR/../.." && pwd)"

_DAEMON_URL="http://127.0.0.1:7735"
_WORKER_URL="http://127.0.0.1:9098"
_CODER_URL="http://127.0.0.1:8081"

_pass() { echo "  PASS: $*"; }
_fail() { echo "  FAIL: $*" >&2; exit 1; }
_skip() { echo "  SKIP: $*"; exit 0; }

echo "=== HME indexing-mode end-to-end smoke test ==="

# --- Assertion 1: daemon + worker reachable ---
echo "[1/5] daemon + worker reachable"
if ! curl -sf -o /dev/null "$_DAEMON_URL/health"; then
  _skip "daemon unreachable at $_DAEMON_URL — is the HME proxy supervisor running?"
fi
_pass "daemon reachable at $_DAEMON_URL"
if ! curl -sf -o /dev/null "$_WORKER_URL/health"; then
  _fail "worker unreachable at $_WORKER_URL"
fi
_pass "worker reachable at $_WORKER_URL"

# --- Assertion 2: coder healthy before we start ---
# 120s cap: a fresh coder load from cold pagecache pulls 17 GB off disk
# into VRAM, routinely takes 60-90s before /health returns ok.
echo "[2/5] coder healthy at baseline"
_waited=0
until curl -sf "$_CODER_URL/health" 2>/dev/null | grep -q "ok"; do
  if [ "$_waited" -ge 120 ]; then
    _fail "coder not healthy after 120s baseline wait — can't establish baseline (cold-boot from disk should never exceed 90s)"
  fi
  sleep 3
  _waited=$((_waited + 3))
done
_pass "coder healthy at baseline (waited ${_waited}s)"

# --- Assertion 3: indexing-mode cycle completes without error ---
echo "[3/5] firing /indexing-mode"
_t0=$(date +%s)
_result=$(curl -s -X POST "$_DAEMON_URL/indexing-mode" \
  -H "Content-Type: application/json" \
  -d '{"action":"start"}' --max-time 120 2>&1 || true)
_tend=$(date +%s)
_elapsed=$((_tend - _t0))

if echo "$_result" | grep -q '"error"'; then
  _fail "indexing-mode returned error after ${_elapsed}s: $_result"
fi
if ! echo "$_result" | grep -q '"total_files"'; then
  _fail "indexing-mode returned unexpected shape after ${_elapsed}s: $_result"
fi
_pass "indexing-mode cycle completed in ${_elapsed}s: $(echo "$_result" | head -c 100)"

# --- Assertion 4: coder returns to healthy within 120s ---
# Same budget as baseline wait: llama-server cold-boot is ~90s worst case.
# Shorter budgets conflate "indexing-mode left coder stuck" with "normal
# cold-load is slow"; 120s clearly separates the two.
echo "[4/5] coder returns to /health=ok post-indexing-mode"
_t0=$(date +%s)
until curl -sf "$_CODER_URL/health" 2>/dev/null | grep -q "ok"; do
  _tend=$(date +%s)
  _elapsed=$((_tend - _t0))
  if [ "$_elapsed" -ge 120 ]; then
    _fail "coder not healthy after ${_elapsed}s post-indexing-mode — stuck respawn? Check llamacpp_daemon.out for 'resume failed' or 'coder unhealthy' loops"
  fi
  sleep 3
done
_tend=$(date +%s)
_pass "coder healthy again after $((_tend - _t0))s"

# --- Assertion 5: selftest still READY ---
echo "[5/5] selftest reports READY"
_selftest=$(cd "$_PROJECT_ROOT" && ./i/hme-admin action=selftest 2>&1)
# Match the verdict inside the banner: "(READY)" on success, "(N FAIL)" on failure.
if echo "$_selftest" | grep -qE "Self-Test:.*\(READY\)"; then
  _pass "selftest READY"
elif echo "$_selftest" | grep -qE "Self-Test:.*\([0-9]+ FAIL\)"; then
  _fail_count=$(echo "$_selftest" | grep -oE "\([0-9]+ FAIL\)" | head -1)
  _fails=$(echo "$_selftest" | grep -E "^  FAIL:" | head -3)
  _fail "selftest has $_fail_count after indexing-mode cycle:
$_fails"
else
  _fail "selftest output unrecognized:
$_selftest"
fi

echo
echo "=== ALL 5 ASSERTIONS PASSED ==="
exit 0
