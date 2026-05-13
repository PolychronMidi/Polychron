#!/usr/bin/env python3
"""Consolidated stop-hook detector runner -- invokes every stop-side
detector in a single Python process instead of 6 subprocess fork+imports.

Stop hook p95 was 5.5s (n=78) because 6-8 serial `python3 <detector>.py`
launches paid ~400-700ms each for interpreter startup + module imports.
Running them all in-process shares the interpreter (one Python startup
for the whole batch) and amortizes repeated imports of common helpers
like `_transcript`.

Each detector's `main()` is reused as-is -- we swap `sys.argv` + redirect
stdout per call and parse the single verdict line. This keeps the
individual detector files runnable standalone (stop.sh can fall back
to invoking them one at a time if run_all.py crashes).

Output: one line per detector, formatted as `<name>=<verdict>`.
Stop.sh parses these with simple grep/cut on `name=`.

Usage: run_all.py <transcript_path>
Exit 0 always (never crash the stop hook).
"""
from __future__ import annotations

import io
import json
import importlib
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


# Load detector list from registry.json (single source of truth).
# Dedup by bash_var: registry has multiple entries per detector module
# (one per fires_when verdict), but run_all.py only needs to invoke each
# python module once per turn -- the module prints whichever verdict applies.
def _load_detectors():
    with open(os.path.join(os.path.dirname(__file__), "registry.json")) as f:
        reg = json.load(f)
    seen_bash_vars = set()
    out = []
    for d in reg["detectors"]:
        bv = d["bash_var"]
        if bv in seen_bash_vars:
            continue
        seen_bash_vars.add(bv)
        # Use the bash_var lowercased as the verdict-line key so detectors.sh
        # parses with `case "$_k" in <var_lower>) BV="$_v" ;;`. For poll_count
        # / idle_after_bg this is the same as the python module name.
        verdict_key = bv.lower()
        out.append((verdict_key, d["module"]))
    return out


DETECTORS = _load_detectors()


def _run_detector(name: str, module_name: str, transcript: str) -> str:
    """Invoke <module>.main() with sys.argv = [module, transcript], capture
    stdout, return the last non-empty line as the verdict. Returns
    'ERR:<exc>' on failure so stop.sh can still parse a line."""
    buf = io.StringIO()
    saved_argv = sys.argv
    try:
        mod = __import__(module_name)
        sys.argv = [module_name, transcript]
        with redirect_stdout(buf):
            mod.main()
    except SystemExit:
        # detector main() calls sys.exit() after printing -- that's normal
        pass
    except Exception as e:
        return f"ERR:{type(e).__name__}:{str(e)[:50]}"
    finally:
        sys.argv = saved_argv
    out = buf.getvalue().strip().splitlines()
    # Use the last non-empty line (most detectors print a single verdict;
    # a few print informational text first + verdict last).
    for line in reversed(out):
        if line.strip():
            return line.strip()
    return "ok"



def _declared_maps():
    with open(os.path.join(os.path.dirname(__file__), "registry.json")) as f:
        reg = json.load(f)["detectors"]
    registry = {}
    for d in reg:
        registry.setdefault(d["module"], set()).add(d["fires_when"])
    declared = {}
    for _, module_name in DETECTORS:
        try:
            mod = importlib.import_module(module_name)
        except Exception:
            continue
        vals = getattr(mod, "DECLARED_VERDICTS", None)
        if vals:
            declared[module_name] = set(vals)
    return declared, registry


def _check_declared_verdicts() -> int:
    declared, registry = _declared_maps()
    failures = []
    for module_name, verdicts in declared.items():
        missing = (verdicts - {"ok"}) - registry.get(module_name, set())
        if missing:
            failures.append(f"{module_name}: undeclared verdicts {sorted(missing)}")
    for msg in failures:
        print(f"DECLARED_VERDICT_DRIFT={msg}")
    return 1 if failures else 0

def main() -> int:
    args = sys.argv[1:]
    if "--check-declared" in args:
        return _check_declared_verdicts()
    if len(args) < 1:
        # No transcript -- print default verdicts so the hook can keep going.
        for name, _ in DETECTORS:
            print(f"{name}=ok" if name != "poll_count" else f"{name}=0")
        return 0

    transcript = args[0]
    for name, module_name in DETECTORS:
        verdict = _run_detector(name, module_name, transcript)
        # flush per-detector: detectors.sh has 3s timeout; without flush a
        # hang would buffer prior verdicts into /dev/null on SIGTERM.
        print(f"{name}={verdict}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
