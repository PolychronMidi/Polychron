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
