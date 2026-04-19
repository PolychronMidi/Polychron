#!/usr/bin/env python3
"""Full end-to-end smoke test for fix_antipattern.

Calls the running HME worker at /tool/hme_admin with action=fix_antipattern,
exercising the whole chain: preflight daemon probe → synthesis → bash
validation → hook file append → revert. Keeps the hook file unmodified on
PASS so the test is idempotent.

This is NOT part of hme_admin(action='selftest') because one synthesis call
costs 30-60s and would push total selftest time past reasonable bounds.
Run from the command line when a full synthesis-path verification is needed:

    python3 tools/HME/scripts/selftest-fix-antipattern.py

Exit 0 on success, 1 on any failure.
"""
from __future__ import annotations
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

_HERE = Path(__file__).resolve()
_PROJECT = _HERE.parent.parent.parent.parent  # .../Polychron
WORKER_URL = os.environ.get("HME_WORKER_URL", "http://127.0.0.1:9098")


def main() -> int:
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

    body = json.dumps({
        "action": "fix_antipattern",
        "antipattern": probe_text,
        "hook_target": hook_target,
    }).encode()
    req = urllib.request.Request(
        f"{WORKER_URL}/tool/hme_admin",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            out = resp.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as e:
        _revert(hook_path, original)
        print(f"FAIL: worker unreachable at {WORKER_URL} — {e}")
        return 1
    except Exception as e:
        _revert(hook_path, original)
        print(f"FAIL: worker request raised — {type(e).__name__}: {e}")
        return 1

    # Always restore the hook first — selftest is idempotent.
    _revert(hook_path, original)

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


def _revert(hook_path: Path, original: str) -> None:
    try:
        with open(hook_path, "w", encoding="utf-8") as f:
            f.write(original)
    except OSError as e:
        print(f"WARN: hook revert failed — manual cleanup needed — {e}")


if __name__ == "__main__":
    sys.exit(main())
