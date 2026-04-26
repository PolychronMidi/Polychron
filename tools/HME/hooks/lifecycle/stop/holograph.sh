# Session-end holograph diff
# Compare the session-start holograph (captured at sessionstart.sh) against
# the current state. Surfaces drift that happened during this session — e.g.,
# a new hook that was added but not registered in hooks.json, a KB entry
# added but not committed, a tool whose docstring was changed. This is where
# the holograph machinery becomes LOAD-BEARING: not just a snapshot, but a
# diff that surfaces unexpected state changes before the agent stops.
SESSION_HOLO="$PROJECT_ROOT/tmp/hme-session-start.holograph.json"
HOLO_SCRIPT="$PROJECT_ROOT/tools/HME/scripts/snapshot-holograph.py"
if [ -f "$SESSION_HOLO" ] && [ -f "$HOLO_SCRIPT" ]; then
  # Run holograph diff with a timeout — purely informational, never blocks.
  # Output goes to a temp file so we can read it without blocking stop.sh.
  _HOLO_TMP=$(mktemp)
  _HOLO_ERR=$(mktemp 2>/dev/null || echo "/tmp/_holo_err_$$")
  # FAIL-LOUD: was double 2>/dev/null. A snapshot-holograph crash here
  # used to vanish completely — the entire end-of-session drift detector
  # silently disabled. Now stderr captured and bridged.
  timeout 2 bash -c "PROJECT_ROOT='$PROJECT_ROOT' python3 '$HOLO_SCRIPT' --diff '$SESSION_HOLO' 2>'$_HOLO_ERR'" > "$_HOLO_TMP" 2>>"$_HOLO_ERR" || true
  DIFF_OUT=$(cat "$_HOLO_TMP" 2>/dev/null)
  if [ -s "$_HOLO_ERR" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
    _HOLO_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    while IFS= read -r _holo_line; do
      [ -n "$_holo_line" ] && echo "[$_HOLO_TS] [stop_holograph] python3 failed (drift detector silenced): $_holo_line" \
        >> "$PROJECT_ROOT/log/hme-errors.log"
    done < "$_HOLO_ERR"
  fi
  rm -f "$_HOLO_TMP" "$_HOLO_ERR" 2>/dev/null
  if [ -n "$DIFF_OUT" ] && ! echo "$DIFF_OUT" | grep -q "No drift"; then
    # Filter noise — only surface dimensions that actually matter
    FILTERED=$(echo "$DIFF_OUT" | grep -vE "^  (hci|streak|onboarding|git_state|kb_summary|pipeline_history|codebase|todo_store)\." || true)
    if [ -n "$FILTERED" ] && [ "$(echo "$FILTERED" | wc -l)" -gt 1 ]; then
      echo "$FILTERED" | head -20 >&2
      echo "" >&2
      echo "[session holograph diff: structural changes above — review before stopping]" >&2
    fi
  fi
fi
