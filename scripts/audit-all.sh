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
#   bash scripts/audit-all.sh             # report-only, always exit 0
#   bash scripts/audit-all.sh --strict    # exit 1 if any audit reports findings
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
run "audit-loc"                  python3 scripts/audit-loc.py $([ "$STRICT" = "1" ] && echo --strict)

# Python F821-class undefined names.
run "audit-python-undefined"     python3 scripts/audit-python-undefined-names.py $([ "$STRICT" = "1" ] && echo --strict)

# Project-wide ASCII enforcement across .py / .js / .sh / .json / .md / .txt.
run "audit-no-non-ascii"         python3 scripts/audit-no-non-ascii.py $([ "$STRICT" = "1" ] && echo --strict)

# Shell `set -u` undefined-var references.
run "audit-shell-undefined"      python3 scripts/audit_shell_undefined_vars.py

# Cross-subsystem import boundaries (reaches-into-internals + public surface).
run "audit-import-boundaries"    python3 scripts/audit-import-boundaries.py $([ "$STRICT" = "1" ] && echo --strict)

# Hook coordination -- MUST RUN BEFORE/AFTER directives in policy/hook
# docstrings vs. actual stop_chain runtime ordering. Acyclic-graph check.
run "audit-hook-coordination"    python3 scripts/audit-hook-coordination.py $([ "$STRICT" = "1" ] && echo --strict)

# DocIntegrity -- cross-reference audit on markdown files. Every
# [text](path) link must resolve, every #anchor must match a heading.
run "audit-doc-integrity"        python3 scripts/audit-doc-integrity.py $([ "$STRICT" = "1" ] && echo --strict)

# Detector <-> deny-prompt link integrity (each prompt's advertised
# alternative paths must be honored by the paired detector).
run "test-deny-alternatives"     python3 tools/HME/scripts/detectors/test_deny_alternatives.py

# Detector chain regression suite -- fixtures that lock detector
# verdicts in place so rescue-clause changes can't silently regress.
run "test-detector-chain"        python3 tools/HME/scripts/detectors/test_detector_chain.py

# Meta-detector: corpus mode reports recall/precision per detector.
run "audit-detectors-corpus"     python3 tools/HME/scripts/detectors/audit_detectors.py --corpus

# ISA audit (PAI-import #1): scaffolds + validates Ideal State Artifact
# documents. No-op when no ISAs exist yet; runs against any tmp/isa/*/ISA.md.
if compgen -G "tmp/isa/*/ISA.md" > /dev/null 2>&1; then
  run "audit-isa"                python3 tools/HME/scripts/isa/audit-isa.py tmp/isa/*/ISA.md
fi

if [ "$failures" -gt 0 ]; then
  echo "audit-all: $failures audit(s) reported findings" >&2
  [ "$STRICT" = "1" ] && exit 1
fi

exit 0
