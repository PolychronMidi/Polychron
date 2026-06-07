# Sourced progress ledger for round runners. Every step writes a durable,
# readable record THE MOMENT it happens, so a round is never a black box: read
# teams/runtime/round-progress.jsonl at any time to see exactly where it is.

: "${PROJECT_ROOT:?PROJECT_ROOT required to source _progress.sh}"
_PROGRESS_FILE="${HME_ROUND_PROGRESS_FILE:-$PROJECT_ROOT/teams/runtime/round-progress.jsonl}"
_PROGRESS_ROUND=""
_PROGRESS_TOTAL="0"
_PROGRESS_DONE="0"
_PROGRESS_FAILED="0"

progress_init() {
  _PROGRESS_ROUND="${1:-round}"
  _PROGRESS_TOTAL="${2:-0}"
  _PROGRESS_DONE="0"
  _PROGRESS_FAILED="0"
  mkdir -p "$(dirname "$_PROGRESS_FILE")"
  : > "$_PROGRESS_FILE"   # fresh ledger per round; per-step replies remain in output files
  progress "round" "start" "$_PROGRESS_ROUND ($_PROGRESS_TOTAL steps)"
}

# Emit one durable JSONL record and one human log line. Terminal peer states
# (done/failed) count toward N; the round meta-step never inflates the counter.
_progress_emit() {
  local step="$1" status="$2" detail="${3:-}" target="${4:-}" rc="${5:-}" reply_bytes="${6:-}" error_log="${7:-}"
  if { [ "$status" = "done" ] || [ "$status" = "failed" ]; } && [ "$step" != "round" ]; then
    _PROGRESS_DONE=$((_PROGRESS_DONE + 1))
  fi
  [ "$status" = "failed" ] && [ "$step" != "round" ] && _PROGRESS_FAILED=$((_PROGRESS_FAILED + 1))
  PROG_FILE="$_PROGRESS_FILE" PROG_ROUND="$_PROGRESS_ROUND" PROG_STEP="$step" \
  PROG_STATUS="$status" PROG_DETAIL="$detail" PROG_DONE="$_PROGRESS_DONE" \
  PROG_TOTAL="$_PROGRESS_TOTAL" PROG_TARGET="$target" PROG_RC="$rc" \
  PROG_REPLY_BYTES="$reply_bytes" PROG_ERROR_LOG="$error_log" python3 - <<'PY'
import json, os, time


def maybe_int(value: str):
    if value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return value


rec = {
    "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "round": os.environ["PROG_ROUND"],
    "step": os.environ["PROG_STEP"],
    "status": os.environ["PROG_STATUS"],
    "detail": os.environ.get("PROG_DETAIL", ""),
    "progress": f"{os.environ['PROG_DONE']}/{os.environ['PROG_TOTAL']}",
}
for key, env_key in (
    ("target", "PROG_TARGET"),
    ("error_log", "PROG_ERROR_LOG"),
):
    value = os.environ.get(env_key, "")
    if value:
        rec[key] = value
for key, env_key in (
    ("rc", "PROG_RC"),
    ("reply_bytes", "PROG_REPLY_BYTES"),
):
    value = maybe_int(os.environ.get(env_key, ""))
    if value is not None:
        rec[key] = value
with open(os.environ["PROG_FILE"], "a", encoding="utf-8") as f:
    f.write(json.dumps(rec) + "\n")
    f.flush()
    os.fsync(f.fileno())
line = f"[{rec['ts']}] [{rec['progress']}] {rec['step']}: {rec['status']}"
if rec.get("target"):
    line += f" target={rec['target']}"
if "rc" in rec:
    line += f" rc={rec['rc']}"
if "reply_bytes" in rec:
    line += f" reply_bytes={rec['reply_bytes']}"
if rec.get("error_log"):
    line += f" error_log={rec['error_log']}"
if rec.get("detail"):
    line += f" -- {rec['detail']}"
print(line, flush=True)
PY
}

progress() {
  _progress_emit "$1" "$2" "${3:-}" "" "" "" ""
}

# progress_result <step> <status> <target> <rc> <reply_bytes> <error_log> [detail]
progress_result() {
  _progress_emit "$1" "$2" "${7:-}" "${3:-}" "${4:-}" "${5:-}" "${6:-}"
}

progress_set_total() {
  _PROGRESS_TOTAL="${1:-$_PROGRESS_TOTAL}"
}

# progress_depth_decision <current_depth> <votes_json> [gates_json] [override_json] [roun
progress_depth_decision() {
  local current_depth="$1" votes_json="$2" gates_json="${3:-[]}" override_json="${4:-null}" round_name="${5:-$_PROGRESS_ROUND}"
  PROJECT_ROOT="$PROJECT_ROOT" python3 "$PROJECT_ROOT/teams/rounds/depth_decision.py" \
    --round "$round_name" --current-depth "$current_depth" --votes-json "$votes_json" \
    --evidence-gates-json "$gates_json" --override-json "$override_json" \
    --current-evidence-epoch "${HME_MESH_EVIDENCE_EPOCH:-}" --ledger "$_PROGRESS_FILE" --append
}

# progress_depth_decision_from_files <current_depth> <role=reply.json>...
progress_depth_decision_from_files() {
  local current_depth="$1"; shift
  python3 - "$@" <<'PY' > "${TMPDIR:-/tmp}/hme-depth-vote-files.$$"
import json, sys
mapping = {}
for item in sys.argv[1:]:
    if "=" not in item:
        continue
    role, path = item.split("=", 1)
    mapping[role] = path
print(json.dumps(mapping))
PY
  PROJECT_ROOT="$PROJECT_ROOT" python3 "$PROJECT_ROOT/teams/rounds/depth_decision.py" \
    --round "$_PROGRESS_ROUND" --current-depth "$current_depth" --votes-from-files-json "$(cat "${TMPDIR:-/tmp}/hme-depth-vote-files.$$")" \
    --votes-json "${HME_MESH_DRIVER_VOTE_JSON:-[]}" --evidence-gates-json "${HME_MESH_EVIDENCE_GATES_JSON:-[]}" \
    --override-json "${HME_MESH_DRIVER_OVERRIDE_JSON:-null}" --current-evidence-epoch "${HME_MESH_EVIDENCE_EPOCH:-}" \
    --ledger "$_PROGRESS_FILE" --append | tee "$PROJECT_ROOT/teams/runtime/output/depth_decision.json"
  local rc=${PIPESTATUS[0]}
  rm -f "${TMPDIR:-/tmp}/hme-depth-vote-files.$$"
  return "$rc"
}

# Mesh-found P1 (red_purple+blue_purple): the final round state must reflect
# per-step failures, not unconditionally claim "done". A reader of only the final
progress_round_finish() {
  local detail="${1:-}"
  if [ "$_PROGRESS_FAILED" -gt 0 ]; then
    progress "round" "failed" "${detail:+$detail; }$_PROGRESS_FAILED step(s) failed"
    return 1
  fi
  progress "round" "done" "$detail"
  return 0
}
