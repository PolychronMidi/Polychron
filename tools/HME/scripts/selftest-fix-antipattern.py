#!/usr/bin/env python3
"""Full end-to-end smoke test for fix_antipattern.

Runs the whole chain: preflight daemon probe → synthesis → bash validation
→ hook file append → revert. Keeps the hook file unmodified on PASS so the
test is idempotent (runs again safely on the next invocation).

This is NOT part of hme_admin(action='selftest') because one synthesis call
costs 30-60s and would push total selftest time past reasonable bounds.
Run from the command line or as a standalone pipeline step when a full
synthesis-path verification is needed:

    python3 tools/HME/scripts/selftest-fix-antipattern.py

Exit 0 on success, 1 on any failure.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve()
_PROJECT = _HERE.parent.parent.parent.parent  # .../Polychron
sys.path.insert(0, str(_PROJECT / "tools" / "HME" / "mcp"))
os.environ.setdefault("PROJECT_ROOT", str(_PROJECT))


def main() -> int:
    try:
        from server.tools_analysis.evolution.evolution_admin import fix_antipattern
    except Exception as e:
        print(f"FAIL: could not import fix_antipattern — {type(e).__name__}: {e}")
        return 1

    marker = "HME-SELFTEST-FIX-ANTIPATTERN-PROBE"
    probe_text = f"selftest probe ({marker}): no-op antipattern for smoke testing"
    hook_target = "pretooluse_bash"
    hook_path = _PROJECT / "tools" / "HME" / "hooks" / "pretooluse" / f"{hook_target}.sh"

    try:
        with open(hook_path, encoding="utf-8") as f:
            original = f.read()
    except OSError as e:
        print(f"FAIL: hook read — {e}")
        return 1

    try:
        out = fix_antipattern(probe_text, hook_target)
    except Exception as e:
        print(f"FAIL: fix_antipattern raised — {type(e).__name__}: {e}")
        # restore in case partial state
        with open(hook_path, "w", encoding="utf-8") as f:
            f.write(original)
        return 1

    # Always restore first — selftest is idempotent.
    try:
        with open(hook_path, "w", encoding="utf-8") as f:
            f.write(original)
    except OSError as e:
        print(f"FAIL: hook revert — manual cleanup needed — {e}")
        return 1

    if "Could not synthesize" in out:
        print(f"FAIL: synthesis empty — {out.splitlines()[0][:200]}")
        return 1
    if "REJECTED" in out:
        print(f"FAIL: bash validation rejected — {out[:400]}")
        return 1
    if "Applied enforcement" not in out:
        print(f"FAIL: unexpected output — {out[:400]}")
        return 1

    print("PASS: fix_antipattern end-to-end — synthesis + bash validation + append + revert succeeded")
    return 0


if __name__ == "__main__":
    sys.exit(main())
