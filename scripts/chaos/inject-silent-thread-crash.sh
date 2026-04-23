#!/usr/bin/env bash
# Chaos injector: write a fake "Exception in thread" line into the daemon
# log, then assert selftest's daemon-thread-hygiene probe catches it.
#
# Prevents probe rot: if someone accidentally neutralizes this probe
# (edits the regex, comments it out), the next nightly chaos run flips
# this script from PASS to FAIL. Self-coherence probes that aren't
# themselves verified to detect their target class decay into dead code.
set -euo pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROJECT_ROOT="$(cd "$_SCRIPT_DIR/../.." && pwd)"
_DAEMON_LOG="$_PROJECT_ROOT/log/hme-llamacpp_daemon.out"

_ts=$(date '+%Y-%m-%d %H:%M:%S,%3N')
_marker="__CHAOS_$(date +%s)__"
_line="$_ts [ERROR] CHAOS_INJECTION $_marker: Exception in thread Thread-CHAOS (_run):
Traceback (most recent call last):
  File \"/chaos/fake.py\", line 1, in _run
ChaosError: injected fault to verify daemon-thread-hygiene probe"

echo "chaos: appending fake thread exception to $_DAEMON_LOG"
printf '%s\n' "$_line" >> "$_DAEMON_LOG"

echo "chaos: running selftest; expecting 'daemon thread hygiene' to FAIL"
cd "$_PROJECT_ROOT"
_out=$(./i/hme-admin action=selftest modules=verbose 2>&1)
if echo "$_out" | grep -qE "FAIL: daemon thread hygiene"; then
  echo "chaos PASS: probe detected the injected fault"
  # Clean up the injected line so normal selftest returns to clean state.
  sed -i "/$_marker/,+3d" "$_DAEMON_LOG"
  exit 0
else
  echo "chaos FAIL: daemon-thread-hygiene probe did NOT detect the injected fault"
  echo "--- selftest output (relevant lines) ---"
  echo "$_out" | grep -E "daemon thread|Self-Test:" || true
  # Leave the injection in place so an operator can inspect.
  echo "(injection left in $_DAEMON_LOG — marker: $_marker)"
  exit 1
fi
