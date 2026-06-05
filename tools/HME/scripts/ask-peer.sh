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
CALLER="${HME_TEAM_CALLER:-${HME_TEAM_ROLE:-driver}}"
CALLER_CHANNEL="$(jq -r --arg caller "$CALLER" '.channel_by_caller[$caller] // empty' <<<"$ROLE_JSON")"
[[ -n "$CALLER_CHANNEL" ]] && CHANNEL="$CALLER_CHANNEL"
[[ -n "$EFFORT" ]] || EFFORT="${HME_TEAM_DEFAULT_EFFORT:-high}"
[[ -n "$ROLE_REPLY_BYTES" ]] || ROLE_REPLY_BYTES="12000"

case "$CHANNEL" in teams/*.md) ;; *) echo "invalid channel for $ROLE: $CHANNEL" >&2; exit 1 ;; esac
case "$SID_FILE" in tmp/.team-*.session) ;; *) echo "invalid session_file for $ROLE: $SID_FILE" >&2; exit 1 ;; esac
case "$TIER" in E1|E2|E3|E4|E5) ;; *) echo "invalid tier for $ROLE: $TIER" >&2; exit 1 ;; esac
case "$EFFORT" in low|medium|high|max) ;; *) echo "invalid effort for $ROLE: $EFFORT" >&2; exit 1 ;; esac

FAMILY=""
case "$ROLE" in
  driver) FAMILY="driver" ;;
  *_lead) FAMILY="team_lead" ;;
  *_purple) FAMILY="team_purple" ;;
  crew_e[1-5]_*) FAMILY="stage_crew" ;;
esac
if [[ -n "$FAMILY" && -f config/models.json ]]; then
  MODEL_TIER="$(jq -r --arg family "$FAMILY" '.team_role_models[$family].tier // empty' config/models.json)"
  EXPECTED_TIER="$MODEL_TIER"
  if [[ "$MODEL_TIER" == "role" ]]; then
    EXPECTED_TIER="$(printf '%s' "$ROLE" | sed -n 's/^crew_e\([1-5]\)_.*/E\1/p')"
  fi
  if [[ -n "$EXPECTED_TIER" && "$TIER" != "$EXPECTED_TIER" ]]; then
    echo "tier drift for $ROLE: roles.json=$TIER models.json=$EXPECTED_TIER" >&2
    exit 1
  fi
fi

if [[ "$CALLER" != "driver" && "${HME_TEAM_DISPATCH_GUARD_OK:-}" != "1" ]]; then
  echo "ask-peer direct dispatch blocked for $CALLER; use team_dispatch_guard.py" >&2
  exit 1
fi

mkdir -p "$(dirname "$CHANNEL")" "$(dirname "$SID_FILE")" tmp
LOCK_FILE="tmp/.team-channel-$(printf '%s' "$CHANNEL" | sed 's#[^A-Za-z0-9_.-]#_#g').lock"

# Driver session that peers FORK from, so every team member inherits the
# driver's full context instead of starting context-blank. Pinned via env
# (propagated through dispatch), else the driver's transcript marker.
DRIVER_SID="${HME_DRIVER_SESSION_ID:-}"
if [[ -z "$DRIVER_SID" && -f tmp/hme-transcript-path.txt ]]; then
  DRIVER_SID="$(basename "$(cat tmp/hme-transcript-path.txt 2>/dev/null)" .jsonl 2>/dev/null || true)"
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

append_turn_locked() {
  local who="$1"
  local text="$2"
  local payload
  payload="$(printf '%s' "$text" | json_string)"
  (
    flock -x 9
    printf '<%s role="%s" tier="%s">%s</%s>\n' "$who" "$ROLE" "$TIER" "$payload" "$who" >> "$CHANNEL"
    cap_channel
  ) 9>>"$LOCK_FILE"
}

append_turn_locked driver "$MSG"

if [[ -n "${HME_ASK_PEER_FAKE_REPLY:-}" ]]; then
  RESP="$HME_ASK_PEER_FAKE_REPLY"
  [[ -s "$SID_FILE" ]] || python3 -c 'import uuid;print(uuid.uuid4())' > "$SID_FILE"
else
  PROJECT_KEY="$(printf '%s' "$ROOT" | sed 's#/#-#g')"
  PEER_SID=""; [[ -s "$SID_FILE" ]] && PEER_SID="$(tr -d '[:space:]' < "$SID_FILE")"
  PEER_TRANSCRIPT="$HOME/.claude/projects/$PROJECT_KEY/$PEER_SID.jsonl"
  if [[ -n "$PEER_SID" && -f "$PEER_TRANSCRIPT" ]]; then
    MODE=(--resume "$PEER_SID")                    # continue this peer's own thread
  elif [[ -n "$DRIVER_SID" ]]; then
    MODE=(--resume "$DRIVER_SID" --fork-session)   # first contact: FORK driver -> inherit full context
  else
    echo "ask-peer: no peer session and no driver session to fork (set HME_DRIVER_SESSION_ID or tmp/hme-transcript-path.txt)" >&2
    exit 1
  fi
  # A forked peer inherits the driver's tools + agentic disposition and will
  # re-explore (long Read/Grep loops) unless constrained. Peers are REVIEWERS
  DISALLOWED="${HME_TEAM_DISALLOWED_TOOLS-Read Grep Glob Bash Edit Write MultiEdit NotebookEdit WebFetch WebSearch Agent}"
  TOOL_ARGS=()
  if [[ -n "$DISALLOWED" ]]; then read -r -a _DIS <<< "$DISALLOWED"; TOOL_ARGS=(--disallowedTools "${_DIS[@]}"); fi
  RAW="$(env -u HME_TEAM_DISPATCH_GUARD_OK -u HME_TEAM_CALLER claude -p "${MODE[@]}" "${TOOL_ARGS[@]}" --output-format json --effort "$EFFORT" --model default "$MSG" 2>/dev/null)"
  RESP="$(jq -r 'if type=="array" then (map(select(.type=="result"))[0].result) else .result end' <<<"$RAW")"
  NEW_SID="$(jq -r 'if type=="array" then (map(select(.type=="result"))[0].session_id) else .session_id end' <<<"$RAW")"
  [[ -n "$NEW_SID" && "$NEW_SID" != "null" ]] && printf '%s\n' "$NEW_SID" > "$SID_FILE"
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

append_turn_locked peer "$RESP"
printf '%s\n' "$RESP"
