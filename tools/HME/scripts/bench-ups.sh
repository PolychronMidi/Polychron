#!/usr/bin/env bash
# One-shot UserPromptSubmit per-step bench (TODO #14b / plan.md P2). Replays the
# hook against a fixed stdin fixture N times with timing redirected to a temp
set -euo pipefail
cd "$(dirname "$0")/../../.."
ROOT="$(pwd)"

N="${1:-20}"
HOOK="$ROOT/tools/HME/hooks/lifecycle/userpromptsubmit.sh"
BENCH_FILE="$(mktemp "${TMPDIR:-/tmp}/ups-bench.XXXXXX.jsonl")"
FIXTURE='{"prompt":"bench probe","user_prompt":"bench probe","session_id":"ups-bench","transcript_path":""}'

trap 'rm -f "$BENCH_FILE"' EXIT

echo "bench-ups: replaying UserPromptSubmit x$N (timing -> $BENCH_FILE)"
for _ in $(seq 1 "$N"); do
  printf '%s' "$FIXTURE" \
    | HME_UPS_TIMING=1 HME_UPS_TIMING_FILE="$BENCH_FILE" PROJECT_ROOT="$ROOT" \
      bash "$HOOK" >/dev/null 2>&1 || true
done

PROJECT_ROOT="$ROOT" python3 "$ROOT/tools/HME/scripts/ups_timing.py" "$BENCH_FILE"
echo "NOTE: cold-start isolation = per-step FLOOR cost; production p95 tail is load-driven and still needs live ups-step-timing.jsonl samples."
