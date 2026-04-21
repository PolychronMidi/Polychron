#!/usr/bin/env python3
"""i/why <invariant-id> — explain an invariant's state.

Reads: hme-invariant-history.json (current state, streak), hme-invariant-efficacy.json
(class + citation count + role), and git log for recent commit references.
"""
from __future__ import annotations
import json
import os
import subprocess
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _load(p):
    full = os.path.join(PROJECT_ROOT, p)
    if not os.path.isfile(full):
        return None
    try:
        with open(full) as f:
            return json.load(f)
    except Exception:
        return None


def main(argv):
    if len(argv) < 2:
        print("Usage: i/why <invariant-id>", file=sys.stderr)
        return 2
    inv_id = argv[1]

    hist = _load("metrics/hme-invariant-history.json") or {}
    eff = _load("metrics/hme-invariant-efficacy.json") or {}
    per_inv = eff.get("per_invariant", {}).get(inv_id)
    if not per_inv:
        print(f"invariant '{inv_id}' not found in efficacy report", file=sys.stderr)
        return 1

    streak = hist.get("fail_streaks", {}).get(inv_id, 0)
    last = hist.get("last_result", {}).get(inv_id, "unknown")
    klass = per_inv.get("class", "?")
    cites = per_inv.get("commits_citing", 0)
    severity = per_inv.get("severity", "?")
    efficacy = per_inv.get("efficacy", 0)

    # Pull config definition
    inv_cfg = _load("tools/HME/config/invariants.json") or {}
    defn = None
    for i in inv_cfg.get("invariants", []):
        if i.get("id") == inv_id:
            defn = i
            break

    print(f"{inv_id}")
    print(f"  class={klass}  severity={severity}  efficacy={efficacy}")
    print(f"  last_result={last}  fail_streak={streak}")
    print(f"  commits_citing: {cites}")
    if defn:
        print(f"  type: {defn.get('type')}")
        desc = defn.get("description", "")
        if desc:
            print(f"  description: {desc[:300]}")
    # Recent git log snippets
    try:
        log = subprocess.check_output(
            ["git", "log", "-30", "--grep", inv_id, "--pretty=%h %s"],
            cwd=PROJECT_ROOT, timeout=10, text=True,
        ).strip()
        if log:
            print("  recent commits citing this id:")
            for line in log.split("\n")[:5]:
                print(f"    {line}")
    except Exception:
        pass
    # Retirement candidate?
    if inv_id in (eff.get("retirement_candidates") or []):
        print("  STATUS: retirement candidate (Arc IV)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
