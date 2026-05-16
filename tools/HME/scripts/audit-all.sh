#!/usr/bin/env bash
# Run every project audit in one shot. Each audit is independent and
# reports its own exit code. The wrapper aggregates findings and
# returns non-zero if ANY audit fails (under --strict).
#
# Order is independence-first: cheaper / more-fundamental audits run
# before slower / more-derived ones, so the first failure surfaces
# without waiting on later steps.
#
# Usage:
#   bash tools/HME/scripts/audit-all.sh             # report-only, always exit 0
#   bash tools/HME/scripts/audit-all.sh --strict    # exit 1 if any audit reports findings
set -uo pipefail

cd "$(dirname "$0")/.."

STRICT=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    *) echo "audit-all: unknown arg $arg" >&2; exit 2 ;;
  esac
done

failures=0

run() {
  local label="$1"; shift
  echo "-- $label --"
  if ! "$@"; then
    failures=$((failures + 1))
    echo "  -> FAILED" >&2
  fi
  echo
}

# Project-wide LOC limits. Honors config/loc-ignore.txt.
run "audit-loc"                  python3 tools/HME/scripts/audit-loc.py $([ "$STRICT" = "1" ] && echo --strict)

# Python F821-class undefined names.
run "audit-python-undefined"     python3 tools/HME/scripts/audit-python-undefined-names.py $([ "$STRICT" = "1" ] && echo --strict)

# Project-wide ASCII enforcement across .py / .js / .sh / .json / .md / .txt.
run "audit-no-non-ascii"         python3 tools/HME/scripts/audit-no-non-ascii.py $([ "$STRICT" = "1" ] && echo --strict)

# Shell `set -u` undefined-var references.
run "audit-shell-undefined"      python3 tools/HME/scripts/audit_shell_undefined_vars.py

# Shared state writer/reader path symmetry.
run "audit-state-file-symmetry"  python3 tools/HME/scripts/audit-state-file-symmetry.py

# HME dogfooding: HME's own Python must obey silent-failure rules.
run "check-hme-dogfooding"      python3 tools/HME/scripts/check-hme-dogfooding.py

# HME proxy middleware load-order guard.
run "check-middleware-order"    python3 tools/HME/scripts/check-middleware-order.py

# Lifecycle writer ownership unit tests.
run "test-lifecycle-writers"    python3 tools/HME/tests/scripts/test-lifecycle-writers.py

# Cross-subsystem import boundaries (reaches-into-internals + public surface).
run "audit-import-boundaries"    python3 tools/HME/scripts/audit-import-boundaries.py $([ "$STRICT" = "1" ] && echo --strict)

# Hook coordination -- MUST RUN BEFORE/AFTER directives in policy/hook
# docstrings vs. actual stop_chain runtime ordering. Acyclic-graph check.
run "audit-hook-coordination"    python3 tools/HME/scripts/audit-hook-coordination.py $([ "$STRICT" = "1" ] && echo --strict)

# DocIntegrity -- cross-reference audit on markdown files. Every
# [text](path) link must resolve, every #anchor must match a heading.
run "audit-doc-integrity"        python3 tools/HME/scripts/audit-doc-integrity.py $([ "$STRICT" = "1" ] && echo --strict)

# Generated music-prior outputs must remain structurally valid.
run "verify-music21-priors"      python3 src/scripts/music21/verify_priors_outputs.py

# Standalone custom ESLint rule regression.
run "test-eslint-map-get"        node src/scripts/eslint-rules/no-or-fallback-on-map-get.test.js

# Generated polyrhythm table must match conductor config ranges.
run "check-polyrhythm-table"     node src/scripts/generatePolyrhythmTable.js --check

# Cold-entrypoint smoke checks keep script CLIs wired without doing writes.
run "verify-provider-manifest"   python3 tools/HME/scripts/verify-provider-manifest.py
run "test-regime-core"           node src/tests/regimeReactiveDampingCore.test.js
run "test-hme-hook-dispatch"     node tools/HME/scripts/hme-hook-test.js
run "smoke-c2m-help"             python3 src/scripts/c2m.py --help
run "smoke-m2c-help"             python3 src/scripts/m2c.py --help
run "smoke-hme-timeline"         python3 tools/HME/scripts/timeline-panel.py window=0s
run "smoke-hme-freeze"           python3 tools/HME/scripts/freeze-check.py
run "check-verdict-predictor"    node src/scripts/pipeline/train-verdict-predictor.js --check
run "check-lance-compaction"     python3 tools/HME/scripts/compact-lance-tables.py --dry-run

# Detector <-> deny-prompt link integrity (each prompt's advertised
# alternative paths must be honored by the paired detector).
run "test-deny-alternatives"     python3 tools/HME/scripts/detectors/test_deny_alternatives.py

# Detector chain regression suite -- fixtures that lock detector
# verdicts in place so rescue-clause changes can't silently regress.
run "test-detector-chain"        python3 tools/HME/scripts/detectors/test_detector_chain.py

# Meta-detector: corpus mode reports recall/precision per detector.
run "audit-detectors-corpus"     python3 tools/HME/scripts/detectors/audit_detectors.py --corpus

# Transcript parser contract tests -- boundary bugs silently disable detectors.
run "test-transcript-api"        python3 tools/HME/scripts/detectors/test__transcript_api.py

# Scope-vs-shipped arithmetic regression suite.
run "test-scope-vs-shipped"      python3 tools/HME/scripts/detectors/test_scope_vs_shipped.py

# Detector registry <-> generated shell wiring.
run "verify-detector-registry"   python3 tools/HME/scripts/detectors/verify_registry_consistency.py

# Review-verdict producer/hook contract.
run "test-hook-contracts"        python3 tools/HME/scripts/test-hook-contracts.py

# Root scripts/ run/reference recency: catches stale pipeline refs and cold deletion candidates.
run "audit-scripts-recency"      python3 tools/HME/scripts/audit-scripts-recency.py --limit 25 $([ "$STRICT" = "1" ] && echo --strict)

# HME scripts dead-code classification.
run "audit-dead-scripts"         python3 tools/HME/scripts/audit-dead-scripts.py


if [ "$failures" -gt 0 ]; then
  echo "audit-all: $failures audit(s) reported findings" >&2
  [ "$STRICT" = "1" ] && exit 1
fi

exit 0
