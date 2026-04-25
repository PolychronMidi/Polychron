#!/usr/bin/env python3
"""Consolidated stop-hook detector runner — invokes every stop-side
detector in a single Python process instead of 6 subprocess fork+imports.

Stop hook p95 was 5.5s (n=78) because 6-8 serial `python3 <detector>.py`
launches paid ~400-700ms each for interpreter startup + module imports.
Running them all in-process shares the interpreter (one Python startup
for the whole batch) and amortizes repeated imports of common helpers
like `_transcript`.

Each detector's `main()` is reused as-is — we swap `sys.argv` + redirect
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
import sys
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


# List of (verdict-name, module-name) pairs. The module must have a
# main() that reads sys.argv[1] as the transcript path and prints a
# single verdict line to stdout.
DETECTORS = [
    ("poll_count", "poll_count"),
    ("idle_after_bg", "idle_after_bg"),
    ("psycho_stop", "psycho_stop"),
    ("ack_skip", "ack_skip"),
    ("abandon_check", "abandon_check"),
    ("stop_work", "stop_work"),
    ("fabrication_check", "fabrication_check"),
    ("early_stop", "early_stop"),
    ("exhaust_check", "exhaust_check"),
]


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
        # detector main() calls sys.exit() after printing — that's normal
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


def main() -> int:
    if len(sys.argv) < 2:
        # No transcript — print default verdicts so the hook can keep going.
        for name, _ in DETECTORS:
            print(f"{name}=ok" if name != "poll_count" else f"{name}=0")
        return 0

    transcript = sys.argv[1]
    for name, module_name in DETECTORS:
        verdict = _run_detector(name, module_name, transcript)
        print(f"{name}={verdict}", flush=True)  # flush per-detector so a
        # subsequent hang doesn't buffer prior verdicts into /dev/null on
        # SIGTERM. The outer detectors.sh has a 3s timeout; without
        # per-line flush, a detector that hangs in _run_detector blocked
        # the whole pipeline and the bash consumer then saw empty stdout
        # with every downstream verdict defaulting to ok. Peer-review 114.
    return 0


if __name__ == "__main__":
    sys.exit(main())
