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
[[ -n "$CTX_MODE" ]] || CTX_MODE="${HME_TEAM_DEFAULT_CTX_MODE:-fresh}"
CALLER="${HME_TEAM_CALLER:-${HME_TEAM_ROLE:-driver}}"
CALLER_CHANNEL="$(jq -r --arg caller "$CALLER" '.channel_by_caller[$caller] // empty' <<<"$ROLE_JSON")"
[[ -n "$CALLER_CHANNEL" ]] && CHANNEL="$CALLER_CHANNEL"
[[ -n "$EFFORT" ]] || EFFORT="${HME_TEAM_DEFAULT_EFFORT:-high}"
[[ -n "$ROLE_REPLY_BYTES" ]] || ROLE_REPLY_BYTES="12000"

case "$CHANNEL" in teams/*.md) ;; *) echo "invalid channel for $ROLE: $CHANNEL" >&2; exit 1 ;; esac
case "$SID_FILE" in teams/runtime/*.session) ;; *) echo "invalid session_file for $ROLE: $SID_FILE" >&2; exit 1 ;; esac
case "$TIER" in E1|E2|E3|E4|E5) ;; *) echo "invalid tier for $ROLE: $TIER" >&2; exit 1 ;; esac
case "$EFFORT" in low|medium|high|max) ;; *) echo "invalid effort for $ROLE: $EFFORT" >&2; exit 1 ;; esac
case "$CTX_MODE" in fork|fresh) ;; *) echo "invalid context_mode for $ROLE: $CTX_MODE" >&2; exit 1 ;; esac

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

# Test-only failure injection (mirrors HME_ASK_PEER_FAKE_REPLY) so the guard's
# reserve-refund-on-failure path can be exercised deterministically.
[[ "${HME_ASK_PEER_FORCE_FAIL:-}" == "1" ]] && { echo "ask-peer: forced failure (test)" >&2; exit 1; }
# Test-only hang with a backgrounded child, to verify the guard killpg's the
# WHOLE process group on timeout (no orphaned grandchild survives the leash).
FORCE_HANG="${HME_ASK_PEER_FORCE_HANG:-}"
[[ -n "$FORCE_HANG" ]] && { sleep "$FORCE_HANG" & wait; exit 0; }

# Role charter: a DISTINCT-agent identity (the self-evolve finding: a pure
# driver-fork shares the driver's identity and contaminates -- it continues the
if [[ -z "$ROLE_SYSTEM" ]]; then
  case "$FAMILY" in
    team_lead)   ROLE_SYSTEM="You are $ROLE, lead of your team. Drive a sharp, decision-changing critique/plan." ;;
    team_purple) ROLE_SYSTEM="You are $ROLE, a purple-team partner. Adversarially stress-test claims and surface what others miss." ;;
    stage_crew)  ROLE_SYSTEM="You are $ROLE, stage crew. Do one concrete verification precisely and report the result." ;;
    *)           ROLE_SYSTEM="You are $ROLE, a distinct team peer." ;;
  esac
fi
ROLE_SYSTEM="$ROLE_SYSTEM You are a DISTINCT agent, NOT the driver. Answer only in your role; never continue the driver's narration or echo the handoff. Be terse and decision-changing."

mkdir -p "$(dirname "$CHANNEL")" "$(dirname "$SID_FILE")" teams/runtime
LOCK_FILE="teams/runtime/channel-$(printf '%s' "$CHANNEL" | sed 's#[^A-Za-z0-9_.-]#_#g').lock"

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
  # Self-evolve finding (red_purple): with real newlines, a raw `tail -n` can
  # bisect a turn and leave a malformed transcript. Cap by line budget BUT
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
# keep whole turns from the end; total kept lines <= cap, but always >=1 turn
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
  # Human-readable: real newlines inside the tag (no JSON-escaped "\n"), so the
  # channel transcripts are auditable as prose.
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

append_turn_locked driver "$MSG"

if [[ -n "${HME_ASK_PEER_FAKE_REPLY:-}" ]]; then
  RESP="$HME_ASK_PEER_FAKE_REPLY"
  [[ -s "$SID_FILE" ]] || python3 -c 'import uuid;print(uuid.uuid4())' > "$SID_FILE"
else
  PROJECT_KEY="$(printf '%s' "$ROOT" | sed 's#/#-#g')"
  PEER_SID=""; [[ -s "$SID_FILE" ]] && PEER_SID="$(tr -d '[:space:]' < "$SID_FILE")"
  PEER_TRANSCRIPT="$HOME/.claude/projects/$PROJECT_KEY/$PEER_SID.jsonl"
  if [[ -n "$PEER_SID" && -f "$PEER_TRANSCRIPT" ]]; then
    MODE=(--resume "$PEER_SID")                    # continue this peer's own distinct thread
  elif [[ "$CTX_MODE" == "fork" && -n "$DRIVER_SID" ]]; then
    MODE=(--resume "$DRIVER_SID" --fork-session)   # context_mode=fork: inherit full driver context
  else
    MODE=(--session-id "$(python3 -c 'import uuid;print(uuid.uuid4())')")  # distinct agent: fresh context + role charter
  fi
  # Peers are REVIEWERS that answer from the charter + the task (which carries
  # the artifact); disallow heavy tools so they don't re-explore (slow) and so a
  DISALLOWED="${HME_TEAM_DISALLOWED_TOOLS-Read Grep Glob Bash Edit Write MultiEdit NotebookEdit WebFetch WebSearch Agent}"
  TOOL_ARGS=()
  if [[ -n "$DISALLOWED" ]]; then read -r -a _DIS <<< "$DISALLOWED"; TOOL_ARGS=(--disallowedTools "${_DIS[@]}"); fi
  # Ephemeral peers must NOT run the HME orchestration hooks: a `-p` peer fires
  # UserPromptSubmit without a SessionStart, tripping the hook watchdog. The HME
  # hooks live in USER settings (~/.claude), so peers load ONLY project,local
  RAW_CAP="${HME_TEAM_MAX_RAW_BYTES:-4000000}"
  SETTING_SOURCES="${HME_TEAM_PEER_SETTING_SOURCES:-project,local}"
  RAW="$(env -u HME_TEAM_DISPATCH_GUARD_OK -u HME_TEAM_CALLER HME_TEAM_PEER=1 \
    claude -p "${MODE[@]}" "${TOOL_ARGS[@]}" --setting-sources "$SETTING_SOURCES" \
    --append-system-prompt "$ROLE_SYSTEM" \
    --output-format json --effort "$EFFORT" --model default "$MSG" 2>/dev/null \
    | head -c "$RAW_CAP")"
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
