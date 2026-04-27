#!/usr/bin/env python3
"""States sync verifier — catches STATES drift between Python and shell.

onboarding_chain.py defines the authoritative STATES list. _onboarding.sh
has a mirror _ONB_STATES array for shell helpers that can't import Python.
If these drift apart, _onb_is_graduated and _onb_at_or_past silently break.

This script parses both files, compares the state lists, and exits non-zero
on mismatch. Runs as part of hme_admin(action='selftest').

Exit codes:
    0 — lists match
    1 — drift detected
    2 — parse error
"""
import os
import re
import sys

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)

_PY_FILE = os.path.join(_PROJECT, "tools", "HME", "service", "server", "onboarding_chain.py")
_SH_FILE = os.path.join(_PROJECT, "tools", "HME", "hooks", "helpers", "_onboarding.sh")


def _parse_python_states() -> list:
    """Extract the STATES list from onboarding_chain.py."""
    with open(_PY_FILE, encoding="utf-8") as f:
        src = f.read()
    match = re.search(
        r'^STATES\s*=\s*\[(.*?)\]',
        src,
        flags=re.DOTALL | re.MULTILINE,
    )
    if not match:
        raise RuntimeError(f"Could not find STATES = [...] in {_PY_FILE}")
    body = match.group(1)
    items = re.findall(r'"([^"]+)"|\'([^\']+)\'', body)
    return [a or b for a, b in items]


def _parse_shell_states() -> list:
    """Extract the _ONB_STATES array from _onboarding.sh."""
    with open(_SH_FILE, encoding="utf-8") as f:
        src = f.read()
    match = re.search(r'_ONB_STATES=\(([^)]+)\)', src)
    if not match:
        raise RuntimeError(f"Could not find _ONB_STATES=(...) in {_SH_FILE}")
    return match.group(1).split()


def main() -> int:
    try:
        py_states = _parse_python_states()
        sh_states = _parse_shell_states()
    except Exception as e:
        print(f"ERROR: {e}")
        return 2

    if py_states == sh_states:
        print(f"OK — STATES match ({len(py_states)} entries): {py_states}")
        return 0

    print("DRIFT DETECTED:")
    print(f"  Python ({_PY_FILE}): {py_states}")
    print(f"  Shell  ({_SH_FILE}): {sh_states}")

    py_set = set(py_states)
    sh_set = set(sh_states)
    only_py = py_set - sh_set
    only_sh = sh_set - py_set
    if only_py:
        print(f"  States in Python only: {sorted(only_py)}")
    if only_sh:
        print(f"  States in shell only:  {sorted(only_sh)}")
    if py_states != sh_states and py_set == sh_set:
        print("  (same entries, different order)")

    print()
    print("Fix: update _ONB_STATES in tools/HME/hooks/helpers/_onboarding.sh to match")
    print("the STATES list in tools/HME/service/server/onboarding_chain.py.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
