#!/usr/bin/env bash
set -euo pipefail

ROOT="${HME_ASK_PEER_PROJECT_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$ROOT"

usage() {
  echo 'usage: ask-peer.sh <role> "message" | ask-peer.sh <role> - < message' >&2
  exit 2
}

ROLE="${1:-}"
[[ -n "$ROLE" ]] || usage
shift || true

if [[ "${1:-}" == "-" ]]; then
  MSG="$(cat)"
else
  [[ $# -gt 0 ]] || usage
  MSG="$*"
fi

ROLES_FILE="teams/roles.json"
[[ -f "$ROLES_FILE" ]] || { echo "missing $ROLES_FILE" >&2; exit 1; }

ROLE_JSON="$(jq -c --arg role "$ROLE" '.roles[$role] // empty' "$ROLES_FILE")"
[[ -n "$ROLE_JSON" ]] || { echo "unknown peer role: $ROLE" >&2; exit 1; }

CHANNEL="$(jq -r '.channel // empty' <<<"$ROLE_JSON")"
SID_FILE="$(jq -r '.session_file // empty' <<<"$ROLE_JSON")"
TIER="$(jq -r '.tier // empty' <<<"$ROLE_JSON")"
EFFORT="$(jq -r '.effort // empty' <<<"$ROLE_JSON")"
ROLE_REPLY_BYTES="$(jq -r '.max_reply_bytes // empty' <<<"$ROLE_JSON")"
[[ -n "$EFFORT" ]] || EFFORT="${HME_TEAM_DEFAULT_EFFORT:-high}"
[[ -n "$ROLE_REPLY_BYTES" ]] || ROLE_REPLY_BYTES="12000"

case "$CHANNEL" in teams/*.md) ;; *) echo "invalid channel for $ROLE: $CHANNEL" >&2; exit 1 ;; esac
case "$SID_FILE" in tmp/.team-*.session) ;; *) echo "invalid session_file for $ROLE: $SID_FILE" >&2; exit 1 ;; esac
case "$TIER" in E1|E2|E3|E4|E5) ;; *) echo "invalid tier for $ROLE: $TIER" >&2; exit 1 ;; esac
case "$EFFORT" in low|medium|high|max) ;; *) echo "invalid effort for $ROLE: $EFFORT" >&2; exit 1 ;; esac

CALLER="${HME_TEAM_ROLE:-driver}"
if [[ "$CALLER" != "driver" && "${HME_TEAM_DISPATCH_GUARD_OK:-}" != "1" ]]; then
  echo "ask-peer direct dispatch blocked for $CALLER; use team_dispatch_guard.py" >&2
  exit 1
fi

mkdir -p "$(dirname "$CHANNEL")" "$(dirname "$SID_FILE")" tmp

if [[ -s "$SID_FILE" ]]; then
  SID="$(tr -d '[:space:]' < "$SID_FILE")"
else
  SID="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
  printf '%s\n' "$SID" > "$SID_FILE"
fi

json_string() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read(), ensure_ascii=False))'
}

cap_channel() {
  local cap="${HME_TEAM_CHANNEL_TAIL_LINES:-500}"
  [[ "$cap" =~ ^[0-9]+$ ]] || cap=500
  (( cap > 0 )) || cap=500
  [[ -f "$CHANNEL" ]] || return 0
  local lines
  lines="$(wc -l < "$CHANNEL" | tr -d ' ')"
  [[ "$lines" =~ ^[0-9]+$ ]] || return 0
  (( lines <= cap )) && return 0
  local tmp
  tmp="$(mktemp "tmp/.team-tail.XXXXXX")"
  tail -n "$cap" "$CHANNEL" > "$tmp"
  mv "$tmp" "$CHANNEL"
}

append_turn() {
  local who="$1"
  local text="$2"
  local payload
  payload="$(printf '%s' "$text" | json_string)"
  printf '<%s role="%s" tier="%s">%s</%s>\n' "$who" "$ROLE" "$TIER" "$payload" "$who" >> "$CHANNEL"
  cap_channel
}

append_turn driver "$MSG"

if [[ -n "${HME_ASK_PEER_FAKE_REPLY:-}" ]]; then
  RESP="$HME_ASK_PEER_FAKE_REPLY"
else
  PROJECT_KEY="$(printf '%s' "$ROOT" | sed 's#/#-#g')"
  TRANSCRIPT="$HOME/.claude/projects/$PROJECT_KEY/$SID.jsonl"
  if [[ -f "$TRANSCRIPT" ]]; then
    MODE=(--resume "$SID")
  else
    MODE=(--session-id "$SID")
  fi
  RESP="$(claude -p "${MODE[@]}" --output-format json --effort "$EFFORT" --model default "$MSG" 2>/dev/null \
    | jq -r 'if type=="array" then (map(select(.type=="result"))[0].result) else .result end')"
fi

MAX_REPLY_BYTES="${HME_TEAM_MAX_REPLY_BYTES:-$ROLE_REPLY_BYTES}"
if [[ "$MAX_REPLY_BYTES" =~ ^[0-9]+$ ]] && (( MAX_REPLY_BYTES > 0 )); then
  RESP="$(RESP="$RESP" MAX_REPLY_BYTES="$MAX_REPLY_BYTES" python3 - <<'PY'
import os
s = os.environ.get('RESP', '')
limit = int(os.environ.get('MAX_REPLY_BYTES', '12000'))
b = s.encode('utf-8')
if len(b) > limit:
    s = b[:limit].decode('utf-8', errors='ignore') + '\n[truncated: peer reply exceeded byte cap]'
print(s, end='')
PY
)"
fi

append_turn peer "$RESP"
printf '%s\n' "$RESP"
