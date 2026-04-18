#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
npm run compile
export HME_PROJECT_ROOT="${HME_PROJECT_ROOT:-$(pwd)/../../..}"
node out/server.js &
SERVER_PID=$!
sleep 1
(chromium http://localhost:3131 2>/dev/null || firefox http://localhost:3131 2>/dev/null) &
wait $SERVER_PID
