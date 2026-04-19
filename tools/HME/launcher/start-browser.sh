#!/usr/bin/env bash
set -e
# Derive project root from this script's location — never from $(pwd), which
# yields garbage when the script is invoked from anywhere other than its own
# directory. HME_PROJECT_ROOT feeds the server's projectRoot so log/metrics/tmp
# writes land at the real root.
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROJECT_ROOT="$(cd "$_SCRIPT_DIR/../../.." && pwd)"
export HME_PROJECT_ROOT="${HME_PROJECT_ROOT:-$_PROJECT_ROOT}"

cd "$_SCRIPT_DIR"
npm run compile
node out/server.js &
SERVER_PID=$!
sleep 1
(chromium http://localhost:3131 2>/dev/null || firefox http://localhost:3131 2>/dev/null) &
wait $SERVER_PID
