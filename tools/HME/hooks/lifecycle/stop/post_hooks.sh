# Signal bus emission alongside the activity bridge. Activity events
# feed analytics; the signal bus is the one-file truth of "what fired
# this turn" for quick replay / status / debugging.
_signal_emit turn_complete stop.sh turn '{}'

# HME activity bridge: emit turn_complete
# Snapshots the CHAT TURN boundary for metrics/hme-activity.jsonl. This is
# NOT round_complete — that fires on pipeline finish (posttooluse_bash.sh
# after `npm run main`). Chat turns happen every few seconds in active use;
# evolution rounds happen on pipeline cadence. Conflating them collapsed
# the coherence-score window to stale data. Separate events keep the
# semantic clean.
_SESSION_ID_FOR_ACTIVITY=$(_safe_jq "$INPUT" '.session_id' 'unknown')
_emit_activity turn_complete --session="$_SESSION_ID_FOR_ACTIVITY"

# Antagonism bridge: record turn for streak calibrator
# Feeds the LIFESAVER streak-sensitivity <-> signal-trust bridge. At turn end
# we snapshot (turnstart_lines, watermark, total_lines) into the calibrator
# history. Resolution-velocity is computed across the rolling window and used
# (observe-only for now) to recommend the next turn's HME_STREAK_WARN.
# See tools/HME/activity/streak_calibrator.py. Silent-fail to keep stop.sh
# non-fragile — this is telemetry, not a gate.
PROJECT_ROOT="$PROJECT" python3 "$PROJECT/tools/HME/activity/streak_calibrator.py" --record \
  > /dev/null 2>&1 &

# Turn-closing audit trail
# Summarize what changed this turn from nexus EDIT entries and emit to stderr
# so it appears in the session log. Silent when nothing was edited.
_EDIT_FILES=$(grep '^EDIT:' "${PROJECT_ROOT}/tmp/hme-nexus.state" 2>/dev/null \
  | sed 's/^EDIT:[0-9]*://' | sort -u)
if [ -n "$_EDIT_FILES" ]; then
  _EDIT_COUNT=$(echo "$_EDIT_FILES" | wc -l | tr -d ' ')
  echo "[turn audit] $_EDIT_COUNT file(s) edited this turn:" >&2
  echo "$_EDIT_FILES" | sed 's/^/  /' >&2
fi
