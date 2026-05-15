# Signal bus emission alongside the activity bridge. Activity events
# feed analytics; the signal bus is the one-file truth of "what fired
# this turn" for quick replay / status / debugging.
_signal_emit turn_complete stop.sh turn '{}'

# activity bridge: turn_complete (chat turn) vs round_complete (pipeline), kept separate
INPUT="${INPUT:?post_hooks.sh requires INPUT from dispatcher (Stop payload)}"
_SESSION_ID_FOR_ACTIVITY=$(_safe_jq "$INPUT" '.session_id' 'unknown')
_emit_activity turn_complete --session="$_SESSION_ID_FOR_ACTIVITY"

# antagonism bridge: record turn for streak calibrator signal-trust tracking
PROJECT_ROOT="$PROJECT" python3 "$PROJECT/tools/HME/activity/streak_calibrator.py" --record \
  > /dev/null 2>&1 &

# Turn-closing audit trail
# silent-ok: optional fallback path.
_EDIT_FILES=$(grep '^EDIT:' "${PROJECT_ROOT}/tmp/hme-nexus.state" 2>/dev/null \
  | sed 's/^EDIT:[0-9]*://' | sort -u)
if [ -n "$_EDIT_FILES" ]; then
  _EDIT_COUNT=$(echo "$_EDIT_FILES" | wc -l | tr -d ' ')
  echo "[turn audit] $_EDIT_COUNT file(s) edited this turn:" >&2
  echo "$_EDIT_FILES" | sed 's/^/  /' >&2
fi

# ingest "what's next" from SUMMARY blocks into HME todo system
_INGESTOR="$PROJECT/tools/HME/scripts/ingest_summary_todos.py"
if [ -f "$_INGESTOR" ]; then
  _TSCRIPT=$(_safe_jq "$INPUT" '.transcript_path' '')
  [ -n "$_TSCRIPT" ] && PROJECT_ROOT="$PROJECT" python3 "$_INGESTOR" "$_TSCRIPT" >/dev/null 2>&1 || true
fi
