#!/usr/bin/env bash
# Send a prompt to the peer Claude (Agent2) over the persisted session and log
# both turns to chat.md. Agent1 = this orchestrator; Agent2 = resumed CLI session.
set -euo pipefail
cd "$(dirname "$0")/.."

SID_FILE="tmp/.agent2_session"
CHAT="chat.md"

if [[ ! -f "$SID_FILE" ]]; then
  echo "no session id at $SID_FILE" >&2
  exit 1
fi
SID="$(cat "$SID_FILE")"

if [[ "${1:-}" == "-" ]]; then
  MSG="$(cat)"
else
  MSG="${1:?usage: ask-agent2.sh \"message\"}"
fi

# Log Agent1's outgoing turn first.
{
  echo "<agent1>$MSG</agent1>"
} >> "$CHAT"

# First turn of a fresh session id uses --session-id to create it; later turns
# --resume it. (A transcript file under ~/.claude/projects means it exists.)
TRANSCRIPT="$HOME/.claude/projects/-home-jah-Polychron/$SID.jsonl"
if [[ -f "$TRANSCRIPT" ]]; then
  MODE=(--resume "$SID")
else
  MODE=(--session-id "$SID")
fi

# Capture clean result text only.
RESP="$(claude -p "${MODE[@]}" --output-format json --effort max --model default "$MSG" 2>/dev/null \
  | jq -r 'if type=="array" then (map(select(.type=="result"))[0].result) else .result end')"

{
  echo "<agent2>$RESP</agent2>"
} >> "$CHAT"

# Echo Agent2's reply to stdout for the orchestrator.
printf '%s\n' "$RESP"
