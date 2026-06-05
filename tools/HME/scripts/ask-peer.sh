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
ROLE_SYSTEM="$(jq -r '.system // empty' <<<"$ROLE_JSON")"
CTX_MODE="$(jq -r '.context_mode // empty' <<<"$ROLE_JSON")"
[[ -n "$CTX_MODE" ]] || CTX_MODE="${HME_TEAM_DEFAULT_CTX_MODE:-fork}"
CALLER="${HME_TEAM_CALLER:-${HME_TEAM_ROLE:-driver}}"
CALLER_CHANNEL="$(jq -r --arg caller "$CALLER" '.channel_by_caller[$caller] // empty' <<<"$ROLE_JSON")"
[[ -n "$CALLER_CHANNEL" ]] && CHANNEL="$CALLER_CHANNEL"
[[ -n "$EFFORT" ]] || EFFORT="${HME_TEAM_DEFAULT_EFFORT:-high}"
[[ -n "$ROLE_REPLY_BYTES" ]] || ROLE_REPLY_BYTES="12000"

case "$CHANNEL" in
  teams/driver.md|teams/red.md|teams/blue.md|teams/purple.md) ;;
  *) echo "invalid channel for $ROLE: $CHANNEL" >&2; exit 1 ;;
esac
if [[ "$SID_FILE" != teams/runtime/*.session || "$(dirname "$SID_FILE")" != "teams/runtime" ]]; then
  echo "invalid session_file for $ROLE: $SID_FILE" >&2
  exit 1
fi
case "$TIER" in E1|E2|E3|E4|E5) ;; *) echo "invalid tier for $ROLE: $TIER" >&2; exit 1 ;; esac
case "$EFFORT" in low|medium|high|max) ;; *) echo "invalid effort for $ROLE: $EFFORT" >&2; exit 1 ;; esac
case "$CTX_MODE" in fork) ;; *) echo "invalid context_mode for $ROLE: $CTX_MODE (only forked peers are allowed)" >&2; exit 1 ;; esac

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

[[ "${HME_ASK_PEER_FORCE_FAIL:-}" == "1" ]] && { echo "ask-peer: forced failure (test)" >&2; exit 1; }
FORCE_HANG="${HME_ASK_PEER_FORCE_HANG:-}"
[[ -n "$FORCE_HANG" ]] && { sleep "$FORCE_HANG" & wait; exit 0; }

if [[ -z "$ROLE_SYSTEM" ]]; then
  case "$FAMILY" in
    team_lead)   ROLE_SYSTEM="You are $ROLE, lead of your team. Drive a sharp, decision-changing critique/plan." ;;
    team_purple) ROLE_SYSTEM="You are $ROLE, a purple-team partner. Adversarially stress-test claims and surface what others miss." ;;
    stage_crew)  ROLE_SYSTEM="You are $ROLE, stage crew. Do one concrete verification precisely and report the result." ;;
    *)           ROLE_SYSTEM="You are $ROLE, a forked team peer." ;;
  esac
fi
ROLE_SYSTEM="$ROLE_SYSTEM You are a forked peer with the driver's full inherited context. Answer only in the requested team role; do not continue driver narration or echo the handoff. Use tools as needed to verify. Be terse and decision-changing."

mkdir -p "$(dirname "$CHANNEL")" "$(dirname "$SID_FILE")" teams/runtime
LOCK_FILE="teams/runtime/channel-$(printf '%s' "$CHANNEL" | sed 's#[^A-Za-z0-9_.-]#_#g').lock"
SAFE_ROLE="$(printf '%s' "$ROLE" | sed 's#[^A-Za-z0-9_.-]#_#g')"
ERR_FILE="teams/runtime/${SAFE_ROLE}.$$.${EPOCHREALTIME//./}.stderr"
RAW_CAP_FILE=""
TRUNC_FILE=""
RESP_FILE=""
SID_OUT_FILE=""
RAW_FIFO=""
RAW_FIFO_DIR=""
cleanup_tmp() { rm -f ${RAW_CAP_FILE:+"$RAW_CAP_FILE"} ${TRUNC_FILE:+"$TRUNC_FILE"} ${RESP_FILE:+"$RESP_FILE"} ${SID_OUT_FILE:+"$SID_OUT_FILE"} ${RAW_FIFO:+"$RAW_FIFO"}; [[ -n "${RAW_FIFO_DIR:-}" ]] && rm -rf "$RAW_FIFO_DIR"; }
trap cleanup_tmp EXIT

valid_sid() {
  [[ "$1" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]
}

resolve_driver_sid() {
  local sid="${HME_DRIVER_SESSION_ID:-}"
  if [[ -z "$sid" && -f tmp/hme-transcript-path.txt ]]; then
    # silent-ok: optional driver-session marker; invalid/missing SID fails closed below.
    sid="$(basename "$(cat tmp/hme-transcript-path.txt 2>/dev/null)" .jsonl 2>/dev/null || true)"
  fi
  printf '%s' "$sid"
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
  tmp="$(mktemp "teams/runtime/tail.XXXXXX")"
  CHANNEL="$CHANNEL" CAP="$cap" python3 - > "$tmp" <<'PY'
import os, re
path, cap = os.environ['CHANNEL'], int(os.environ['CAP'])
lines = open(path, encoding='utf-8').read().split('\n')
header, rest = (lines[0] if lines else ''), lines[1:]
starts = [i for i, l in enumerate(rest) if re.match(r'^<(driver|peer) ', l)]
if not starts:
    print('\n'.join(lines), end=''); raise SystemExit
keep = starts[-1]
for s in reversed(starts):
    if (len(rest) - s) <= cap:
        keep = s
    else:
        break
print('\n'.join([header] + rest[keep:]), end='')
PY
  mv "$tmp" "$CHANNEL"
}

append_turn_locked() {
  local who="$1"
  local text="$2"
  text="${text//<driver/‹driver}"
  text="${text//<\/driver/‹/driver}"
  text="${text//<peer/‹peer}"
  text="${text//<\/peer/‹/peer}"
  (
    flock -x 9
    {
      printf '<%s role="%s" tier="%s">\n' "$who" "$ROLE" "$TIER"
      printf '%s\n' "$text"
      printf '</%s>\n\n' "$who"
    } >> "$CHANNEL"
    cap_channel
  ) 9>>"$LOCK_FILE"
}

append_exchange() {
  local peer_text="$1"
  local driver_text="$MSG"
  driver_text="${driver_text//<driver/‹driver}"
  driver_text="${driver_text//<\/driver/‹/driver}"
  driver_text="${driver_text//<peer/‹peer}"
  driver_text="${driver_text//<\/peer/‹/peer}"
  peer_text="${peer_text//<driver/‹driver}"
  peer_text="${peer_text//<\/driver/‹/driver}"
  peer_text="${peer_text//<peer/‹peer}"
  peer_text="${peer_text//<\/peer/‹/peer}"
  (
    flock -x 9
    {
      printf '<driver role="%s" tier="%s">\n' "$ROLE" "$TIER"
      printf '%s\n' "$driver_text"
      printf '</driver>\n\n'
      printf '<peer role="%s" tier="%s">\n' "$ROLE" "$TIER"
      printf '%s\n' "$peer_text"
      printf '</peer>\n\n'
    } >> "$CHANNEL"
    cap_channel
  ) 9>>"$LOCK_FILE"
}

FAKE_REPLY="${HME_ASK_PEER_FAKE_REPLY:-}"
if [[ -n "$FAKE_REPLY" ]]; then
  RESP="$FAKE_REPLY"
  [[ -s "$SID_FILE" ]] || python3 -c 'import uuid;print(uuid.uuid4())' > "$SID_FILE"
else
  DRIVER_SID="$(resolve_driver_sid)"
  if ! valid_sid "$DRIVER_SID"; then
    echo "context_mode=fork for $ROLE but no valid driver session id (set HME_DRIVER_SESSION_ID or tmp/hme-transcript-path.txt)" >&2
    exit 1
  fi

  PROJECT_KEY="$(printf '%s' "$ROOT" | sed 's#/#-#g')"
  PEER_SID=""; [[ -s "$SID_FILE" ]] && PEER_SID="$(tr -d '[:space:]' < "$SID_FILE")"
  PEER_TRANSCRIPT="$HOME/.claude/projects/$PROJECT_KEY/$PEER_SID.jsonl"
  if [[ -n "$PEER_SID" ]]; then
    if ! valid_sid "$PEER_SID"; then
      rm -f "$SID_FILE"
      PEER_SID=""
    elif [[ ! -f "$PEER_TRANSCRIPT" ]]; then
      PEER_SID=""
    fi
  fi
  if [[ -n "$PEER_SID" ]]; then
    MODE=(--resume "$PEER_SID")
  else
    MODE=(--resume "$DRIVER_SID" --fork-session)
  fi

  RAW_CAP="${HME_TEAM_MAX_RAW_BYTES:-4000000}"
  [[ "$RAW_CAP" =~ ^[0-9]+$ ]] || RAW_CAP=4000000
  (( RAW_CAP > 0 )) || RAW_CAP=4000000
  SETTING_SOURCES="${HME_TEAM_PEER_SETTING_SOURCES:-project,local}"
  RAW_CAP_FILE="$(mktemp "teams/runtime/raw-cap.${SAFE_ROLE}.XXXXXX")"
  TRUNC_FILE="$(mktemp "teams/runtime/raw-trunc.${SAFE_ROLE}.XXXXXX")"
  RESP_FILE="$(mktemp "teams/runtime/reply.${SAFE_ROLE}.XXXXXX")"
  SID_OUT_FILE="$(mktemp "teams/runtime/sid.${SAFE_ROLE}.XXXXXX")"

  RAW_FIFO="$(mktemp -u "teams/runtime/raw-fifo.${SAFE_ROLE}.XXXXXX")"
  mkfifo "$RAW_FIFO"
  python3 -c 'import sys
out_path, cap_s, flag_path = sys.argv[1:4]
cap = int(cap_s)
seen = 0
truncated = False
with open(out_path, "wb") as out:
    while True:
        chunk = sys.stdin.buffer.read(65536)
        if not chunk:
            break
        if seen < cap:
            take = min(len(chunk), cap - seen)
            out.write(chunk[:take])
        if seen + len(chunk) > cap:
            truncated = True
        seen += len(chunk)
open(flag_path, "w", encoding="utf-8").write("1" if truncated else "0")' "$RAW_CAP_FILE" "$RAW_CAP" "$TRUNC_FILE" < "$RAW_FIFO" &
  CAP_PID=$!
  set +e
  env -u HME_TEAM_DISPATCH_GUARD_OK -u HME_TEAM_CALLER HME_TEAM_PEER=1 \
    claude -p "${MODE[@]}" --setting-sources "$SETTING_SOURCES" \
    --append-system-prompt "$ROLE_SYSTEM" \
    --output-format json --effort "$EFFORT" --model default "$MSG" \
    > "$RAW_FIFO" 2>"$ERR_FILE"
  CLAUDE_STATUS=$?
  wait "$CAP_PID"
  CAP_STATUS=$?
  set -e
  if (( CAP_STATUS != 0 )); then
    RESP="[peer-error: raw stdout capper exited $CAP_STATUS; stderr: $ERR_FILE]"
    append_exchange "$RESP"
    printf '%s\n' "$RESP"
    exit "$CAP_STATUS"
  fi
  if (( CLAUDE_STATUS != 0 )); then
    RESP="[peer-error: claude exited $CLAUDE_STATUS; stderr: $ERR_FILE]"
    append_exchange "$RESP"
    printf '%s\n' "$RESP"
    exit "$CLAUDE_STATUS"
  fi

  TRUNCATED="$(cat "$TRUNC_FILE" 2>/dev/null || printf '0')"
  if ! python3 - "$RAW_CAP_FILE" "$RESP_FILE" "$SID_OUT_FILE" "$TRUNCATED" <<'PY'
import json, sys
raw_path, resp_path, sid_path, truncated = sys.argv[1:5]
raw = open(raw_path, 'rb').read().decode('utf-8', errors='replace')
try:
    obj = json.loads(raw)
    if isinstance(obj, list):
        obj = next((x for x in obj if isinstance(x, dict) and x.get('type') == 'result'), {})
    if not isinstance(obj, dict):
        obj = {}
    reply = obj.get('result') or ''
    sid = obj.get('session_id') or ''
    if not isinstance(reply, str):
        reply = ''
    if not isinstance(sid, str):
        sid = ''
    open(resp_path, 'w', encoding='utf-8').write(reply)
    open(sid_path, 'w', encoding='utf-8').write(sid)
except Exception as e:
    note = '[peer-error: invalid peer JSON'
    if truncated == '1':
        note += ' (truncated by raw byte cap)'
    note += f': {type(e).__name__}]'
    open(resp_path, 'w', encoding='utf-8').write(note)
    open(sid_path, 'w', encoding='utf-8').write('')
    raise SystemExit(1)
PY
  then
    RESP="$(cat "$RESP_FILE")"
    append_exchange "$RESP"
    printf '%s\n' "$RESP"
    exit 1
  fi
  RESP="$(cat "$RESP_FILE")"
  NEW_SID="$(cat "$SID_OUT_FILE")"
  if [[ -n "$NEW_SID" ]]; then
    if valid_sid "$NEW_SID"; then
      printf '%s\n' "$NEW_SID" > "$SID_FILE"
    else
      RESP="[peer-error: invalid session_id returned by claude; stderr: $ERR_FILE]"
      append_exchange "$RESP"
      printf '%s\n' "$RESP"
      exit 1
    fi
  fi
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

append_exchange "$RESP"
printf '%s\n' "$RESP"
