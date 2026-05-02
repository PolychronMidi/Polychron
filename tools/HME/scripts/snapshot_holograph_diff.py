"""Diff and replay logic for snapshot-holograph.

Pure functions -- no side effects beyond stdout/stderr writes from _replay's
human-readable summary mode.
"""
import json
import os
import sys


# Fields that vary between runs but don't represent real drift --
# excluded from diff output to keep signal-to-noise high.
_NOISE_KEYS = {
    "captured_at", "captured_at_human", "timestamp",
    "duration_ms", "updated_ts",
}


def _diff(a: dict, b: dict, path: str = "") -> list:
    """Recursive diff between two holograph dicts. Returns list of (path, a_val, b_val).

    Filters out timing/timestamp noise so output focuses on REAL state drift.
    """
    diffs = []
    keys = set(a.keys()) | set(b.keys())
    for k in sorted(keys):
        sub = f"{path}.{k}" if path else k
        if k.startswith("_") or k in _NOISE_KEYS:
            continue
        av = a.get(k, "<missing>")
        bv = b.get(k, "<missing>")
        if isinstance(av, dict) and isinstance(bv, dict):
            diffs.extend(_diff(av, bv, sub))
        elif isinstance(av, list) and isinstance(bv, list):
            if json.dumps(av, sort_keys=True) != json.dumps(bv, sort_keys=True):
                diffs.append((sub, f"<list len={len(av)}>", f"<list len={len(bv)}>"))
        elif av != bv:
            diffs.append((sub, av, bv))
    return diffs


def _replay(path: str) -> int:
    """Load an old holograph and display its state as if it were current.
    Time-travel debugging -- see exactly what HCI + verifier state was at that
    moment. Useful for answering "what broke at time X?" after the fact."""
    if not os.path.isfile(path):
        sys.stderr.write(f"replay path not found: {path}\n")
        return 2
    try:
        with open(path) as f:
            snap = json.load(f)
    except Exception as e:
        sys.stderr.write(f"replay parse error: {e}\n")
        return 2
    print(f"# Holograph replay: {path}")
    print(f"  Captured: {snap.get('captured_at_human', '?')}")
    print(f"  Project:  {snap.get('project_root', '?')}")
    print()
    hci = snap.get("hci", {})
    score = hci.get("hci", "?")
    print(f"  HCI at that moment: {score}")
    cats = hci.get("categories", {})
    if cats:
        for cat in sorted(cats.keys()):
            info = cats[cat]
            print(f"    {cat:12} {info.get('score', 0)*100:5.1f}%")
    print()
    verifiers = hci.get("verifiers", {})
    failed = [(n, v) for n, v in verifiers.items() if v.get("status") in ("FAIL", "ERROR")]
    warned = [(n, v) for n, v in verifiers.items() if v.get("status") == "WARN"]
    if failed:
        print(f"## FAIL/ERROR verifiers at that moment ({len(failed)})")
        for n, v in failed:
            print(f"  {v.get('status'):5}  {n:30}  {v.get('summary', '')}")
    if warned:
        print(f"## WARN verifiers ({len(warned)})")
        for n, v in warned:
            print(f"  WARN   {n:30}  {v.get('summary', '')}")
    if not failed and not warned:
        print("## All verifiers were passing at that moment")
    print()
    onb = snap.get("onboarding", {})
    print(f"Onboarding state: {onb.get('state', '?')} (target: {onb.get('target', '')})")
    git = snap.get("git_state", {})
    print(f"Git: branch={git.get('branch', '?')} dirty={git.get('dirty_count', 0)} last={git.get('last_commit', '?')[:60]}")
    tool_surface = snap.get("tool_surface", {})
    print(f"Tool surface: {tool_surface.get('count_public', '?')} public + {tool_surface.get('count_hidden', '?')} hidden")
    return 0
