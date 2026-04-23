#!/usr/bin/env bash
# Chaos injector: spawn an extra fake llama-server process briefly,
# then assert selftest's llama-server-count probe catches the count
# exceeding the declared topology (2).
#
# Since we don't want to actually eat VRAM, we spawn a `sleep 600`
# renamed via a symlink to look like "tools/bin/llama-server" so pgrep
# matches. The process is killed within 5s; the point is to verify
# the probe detects count drift while it exists.
set -euo pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROJECT_ROOT="$(cd "$_SCRIPT_DIR/../.." && pwd)"
_FAKE_SYMLINK="/tmp/hme-chaos-fake-llama-server"

# The probe matches processes whose cmdline contains 'tools/bin/llama-server'.
# We create a symlink so the cmdline literally contains that path.
ln -sf /bin/sleep "$_FAKE_SYMLINK" 2>/dev/null || true

# Also make a copy named to look like "tools/bin/llama-server" in $_PROJECT_ROOT
# so pgrep -f tools/bin/llama-server matches it.
_FAKE_BIN="$_PROJECT_ROOT/tools/bin/llama-server-chaos-decoy"
cp -f /bin/sleep "$_FAKE_BIN"

echo "chaos: spawning fake process imitating tools/bin/llama-server"
# Launch in the background, detach with setsid.
setsid "$_FAKE_BIN" 30 >/dev/null 2>&1 &
_FAKE_PID=$!
disown

# Give pgrep a moment to see it.
sleep 1

echo "chaos: running selftest; expecting llama-server-count > 2"
cd "$_PROJECT_ROOT"
# pgrep still matches "tools/bin/llama-server" within "tools/bin/llama-server-chaos-decoy"
# because of substring matching.
_out=$(./i/hme-admin action=selftest modules=verbose 2>&1)

# Clean up fake process + binary before interpreting result so we leave
# no orphans if the assertion fails.
kill "$_FAKE_PID" 2>/dev/null || true
rm -f "$_FAKE_BIN" "$_FAKE_SYMLINK"

if echo "$_out" | grep -qE "FAIL: llama-server count"; then
  echo "chaos PASS: probe detected the extra process"
  exit 0
else
  echo "chaos FAIL: llama-server-count probe did NOT detect the injected process"
  echo "--- selftest output (relevant lines) ---"
  echo "$_out" | grep -E "llama-server|daemon uniqueness" || true
  exit 1
fi
