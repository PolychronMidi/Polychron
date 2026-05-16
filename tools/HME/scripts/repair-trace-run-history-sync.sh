#!/usr/bin/env bash
set -euo pipefail
ROOT="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
: "${METRICS_DIR:=${ROOT}/output/metrics}"
export PROJECT_ROOT="$ROOT" METRICS_DIR
node scripts/pipeline/trace-summary.js
node scripts/pipeline/snapshot-run.js
