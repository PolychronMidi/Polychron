# Sourced progress ledger for round runners. Every step writes a durable,
# readable record THE MOMENT it happens, so a round is never a black box: read
# teams/runtime/round-progress.jsonl at any time to see exactly where it is, and

: "${PROJECT_ROOT:?PROJECT_ROOT required to source _progress.sh}"
_PROGRESS_FILE="${HME_ROUND_PROGRESS_FILE:-$PROJECT_ROOT/teams/runtime/round-progress.jsonl}"
_PROGRESS_ROUND=""
_PROGRESS_TOTAL="0"
_PROGRESS_DONE="0"

progress_init() {
  _PROGRESS_ROUND="${1:-round}"
  _PROGRESS_TOTAL="${2:-0}"
  _PROGRESS_DONE="0"
  mkdir -p "$(dirname "$_PROGRESS_FILE")"
  : > "$_PROGRESS_FILE"   # fresh ledger per round (old one is in git/runtime history if needed)
  progress "round" "start" "$_PROGRESS_ROUND ($_PROGRESS_TOTAL steps)"
}

# Append one JSONL record (robust escaping + fsync) AND echo a human line to
# stdout so the launch log shows step-by-step progress too -- never just a final
progress() {
  local step="$1" status="$2" detail="${3:-}"
  # Count only completed PEER steps toward N; the "round" start/done meta-step
  # must not inflate the counter (was showing N+1/N at the end).
  [ "$status" = "done" ] && [ "$step" != "round" ] && _PROGRESS_DONE=$((_PROGRESS_DONE + 1))
  PROG_FILE="$_PROGRESS_FILE" PROG_ROUND="$_PROGRESS_ROUND" PROG_STEP="$step" \
  PROG_STATUS="$status" PROG_DETAIL="$detail" PROG_DONE="$_PROGRESS_DONE" \
  PROG_TOTAL="$_PROGRESS_TOTAL" python3 - <<'PY'
import json, os, time
rec = {
    "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "round": os.environ["PROG_ROUND"],
    "step": os.environ["PROG_STEP"],
    "status": os.environ["PROG_STATUS"],
    "detail": os.environ.get("PROG_DETAIL", ""),
    "progress": f"{os.environ['PROG_DONE']}/{os.environ['PROG_TOTAL']}",
}
with open(os.environ["PROG_FILE"], "a", encoding="utf-8") as f:
    f.write(json.dumps(rec) + "\n")
    f.flush()
    os.fsync(f.fileno())
print(f"[{rec['ts']}] [{rec['progress']}] {rec['step']}: {rec['status']}"
      + (f" -- {rec['detail']}" if rec['detail'] else ""), flush=True)
PY
}
