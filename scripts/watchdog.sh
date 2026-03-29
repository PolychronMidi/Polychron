#!/usr/bin/env bash
# watchdog.sh — wraps npm run main with per-measure timeout monitoring.
# Usage: bash scripts/watchdog.sh [measure_timeout_seconds]
# Default timeout: 15s per measure. Kills the entire process tree if exceeded.

TIMEOUT=${1:-15}
LOG="log/main.log"

npm run main &
PID=$!

echo "Watchdog: pipeline PID=$PID, measure timeout=${TIMEOUT}s"

sleep 15
while kill -0 $PID 2>/dev/null; do
  LAST=$(tail -1 "$LOG" 2>/dev/null)
  SECS=$(echo "$LAST" | grep -oP 'done \(\K[0-9.]+')
  if [ -n "$SECS" ] && [ "$(echo "$SECS > $TIMEOUT" | bc)" = "1" ]; then
    echo "WATCHDOG: measure took ${SECS}s (limit ${TIMEOUT}s) — killing process tree"
    pkill -9 -P $PID 2>/dev/null
    kill -9 $PID 2>/dev/null
    pkill -9 -f "node src/play/main" 2>/dev/null
    wait $PID 2>/dev/null
    exit 1
  fi
  sleep 3
done

wait $PID
EXIT=$?
if [ $EXIT -eq 0 ]; then
  echo "Watchdog: pipeline completed successfully"
else
  echo "Watchdog: pipeline failed (exit $EXIT)"
fi
exit $EXIT
