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
: "${PROJECT_ROOT:=$ROOT}"
: "${METRICS_DIR:=$ROOT/src/output/metrics}"
export PROJECT_ROOT METRICS_DIR

run() {
  local label="$1"; shift
  printf '[verify] %s... ' "$label"
  local out
  if out=$("$@" 2>&1); then
    printf 'ok\n'
  else
    printf 'FAIL\n%s\n' "$out" >&2
    return 1
  fi
}

run json-config python3 tools/HME/scripts/invariants/check_invariant_config.py
run born-from python3 tools/HME/scripts/invariants/check_born_from_migration.py
run hardcoded-metrics python3 tools/HME/scripts/invariants/check_source_grep_invariant.py no-hardcoded-metrics-path
run env-os python3 tools/HME/scripts/invariants/check_source_grep_invariant.py hme-py-no-os-environ
run env-raw python3 tools/HME/scripts/invariants/check_source_grep_invariant.py hme-no-raw-os-environ
run env-waiver-categories python3 tools/HME/scripts/check-env-ok-categories.py tools/HME
run unnamed-except python3 tools/HME/scripts/check-unnamed-except.py tools/HME/service/server
run silent-fallback python3 tools/HME/scripts/check-silent-fallback.py tools/HME/service
run silent-except python3 tools/HME/scripts/check-silent-except.py tools/HME/service/server
run silent-source python3 tools/HME/scripts/check-shell-silent-source.py tools/HME/hooks
run py-compile python3 -m py_compile tools/HME/scripts/invariants/*.py tools/HME/service/server/tools_analysis/evolution/evolution_invariants/*.py
run invariants bash -c 'PYTHONPATH=tools/HME/service python3 - <<"PY" >/tmp/hme-invariants.verify
from server.tools_analysis.evolution.evolution_invariants import check_invariants
out = check_invariants(verbose=False)
print(out)
raise SystemExit(0 if "170/170 passed" in out or "171/171 passed" in out or "172/172 passed" in out or "173/173 passed" in out else 1)
PY'
run node-hme-specs node --test tools/HME/tests/specs/*.test.js
run audit-all bash tools/HME/scripts/audit-all.sh --strict
