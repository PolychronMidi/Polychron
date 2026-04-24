#!/usr/bin/env python3
"""Controlled-incoherence controller.

The opposite of a stability controller. When the observation apparatus
has plateaued — L∞∞ reports near-zero drift, HCI score is flat, every
verifier is green, detector hits are at baseline — the system is in
REST equilibrium. That's healthy for short windows but CALCIFIED over
long windows: the agent hasn't been challenged, so we don't know if
coherence is real or just lucky baseline.

This controller PERTURBS the system on demand:
  - Injects a small synthetic deferral phrase ("banked for later") into
    the agent's next response-eligible stop to verify exhaust_check
    still catches it.
  - Temporarily widens a `set +u` scope to verify `holograph`-class
    regressions would still be caught by the stop-chain defense.
  - Rotates the subagent_type hint to verify the dispatch path still
    routes all types correctly.

Use: invoke manually when HCI has been flat for N sessions. Each
perturbation logs to `output/metrics/hme-controlled-incoherence.jsonl`
with:
  - timestamp
  - perturbation_type
  - expected_response (which detector/invariant SHOULD catch it)
  - actual_response (what the system did)
  - verdict: "caught" | "missed" | "false_positive_elsewhere"

Catalog of planned perturbations (MVP implements #1 and #2):
  1. exhaust_check coverage: inject banked-phrase; assert violation.
  2. ShellUndefinedVarsVerifier: temp-rename a known var; assert flag.
  3. Hang-escalation: temp-fire pulse CPU probe; assert SIGTERM.
  4. Sentinel dispatch: queue a fake subagent task; assert capture.
  5. LIFESAVER watermark: append a synthetic error; assert next-turn surfacing.

Each perturbation is idempotent and reversible. A perturbation that the
system FAILS to catch is a gap in coverage — that's the signal this
controller is designed to surface.

Run: controlled-incoherence.py <perturbation_id>
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path


ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parent.parent.parent.parent)
LOG = ROOT / "output" / "metrics" / "hme-controlled-incoherence.jsonl"


def _record(entry: dict) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    entry["ts"] = int(time.time())
    with open(LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")


def perturb_exhaust_check() -> dict:
    """Synthesize a transcript with the 'banked for later' register.
    Run exhaust_check directly. Expected: verdict=exhaust_violation.
    If it returns 'ok', exhaust_check has drifted."""
    synth = tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False)
    synth.write(json.dumps({
        "type": "user",
        "message": {"role": "user", "content": "test"},
    }) + "\n")
    synth.write(json.dumps({
        "type": "assistant",
        "message": {"role": "assistant", "content": [{
            "type": "text",
            # Text must be >200 chars to trip the closing-position gate,
            # so pad the prose enough that the detector takes it seriously.
            "text": ("Completed the requested fixes across the affected paths — "
                     "verified lint, typecheck, and the detector chain pass cleanly. "
                     "All test suites green, and the worker restart picked up the "
                     "new code without issues. Summary of changes is captured in the "
                     "commit log for your review.\n\n"
                     "**Still banked (not actionable right now):**\n"
                     "- supervisor/index.js hang-escalation — takes effect on next "
                     "proxy restart; won't restart while you're using chat.\n"
                     "- claudeProcessPool.ts productivity watchdog — takes effect "
                     "on next extension-host reload (your action, not mine).\n\n"
                     "Nothing else missing within the scope of this session's fixes.")
        }]},
    }) + "\n")
    synth.close()
    try:
        detector = ROOT / "tools" / "HME" / "scripts" / "detectors" / "exhaust_check.py"
        r = subprocess.run([sys.executable, str(detector), synth.name],
                           capture_output=True, text=True, timeout=10)
        verdict = (r.stdout or "").strip().splitlines()[-1] if r.stdout.strip() else "(empty)"
    finally:
        os.unlink(synth.name)
    entry = {
        "perturbation": "exhaust_check_coverage",
        "expected": "exhaust_violation",
        "actual": verdict,
        "outcome": "caught" if verdict == "exhaust_violation" else "MISSED — exhaust_check has drifted!",
    }
    _record(entry)
    return entry


def perturb_shell_undefined() -> dict:
    """Create a temporary .sh file with an undefined var, run the audit,
    assert it's caught. Clean up the test file."""
    test_dir = ROOT / "tools" / "HME" / "hooks" / "lifecycle"
    test_file = test_dir / "_perturbation_test.sh"
    try:
        test_file.write_text('#!/usr/bin/env bash\necho "$UNDEFINED_VAR_FOR_PERTURBATION_XYZ"\n')
        audit = ROOT / "scripts" / "audit-shell-undefined-vars.py"
        r = subprocess.run([sys.executable, str(audit), "--json"],
                           capture_output=True, text=True, timeout=15)
        try:
            payload = json.loads(r.stdout)
        except json.JSONDecodeError:
            payload = {"violation_count": -1}
        caught = False
        for f in payload.get("files", []):
            if "_perturbation_test.sh" in f.get("file", ""):
                for v in f.get("findings", []):
                    if "UNDEFINED_VAR_FOR_PERTURBATION_XYZ" == v.get("var"):
                        caught = True
                        break
        outcome = "caught" if caught else "MISSED — audit has drifted!"
    finally:
        try: test_file.unlink()
        except OSError: pass
    entry = {
        "perturbation": "shell_undefined_audit_coverage",
        "expected": "detect UNDEFINED_VAR_FOR_PERTURBATION_XYZ",
        "actual": "found" if caught else "not-found",
        "outcome": outcome,
    }
    _record(entry)
    return entry


_PERTURBATIONS = {
    "exhaust_check": perturb_exhaust_check,
    "shell_undefined": perturb_shell_undefined,
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("perturbation", choices=list(_PERTURBATIONS) + ["all"],
                    help="Which perturbation to run (or 'all')")
    args = ap.parse_args()

    to_run = list(_PERTURBATIONS) if args.perturbation == "all" else [args.perturbation]
    any_miss = False
    for p in to_run:
        entry = _PERTURBATIONS[p]()
        ok = "MISSED" not in entry["outcome"]
        marker = "✓" if ok else "✗"
        print(f"  {marker} {p}: {entry['outcome']}")
        if not ok:
            any_miss = True
    return 0 if not any_miss else 1


if __name__ == "__main__":
    sys.exit(main())
