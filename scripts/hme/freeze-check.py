#!/usr/bin/env python3
"""i/freeze check — does the arc-freeze marker permit a proposed action?"""
from __future__ import annotations
import json
import os
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FREEZE = os.path.join(PROJECT_ROOT, "tools", "HME", "config", "arc-freeze.json")


def main(argv):
    if not os.path.isfile(FREEZE):
        print("No arc-freeze marker present — all actions permitted.")
        return 0
    with open(FREEZE) as f:
        m = json.load(f)
    print(f"arc-freeze: frozen_in={m.get('frozen_in')} thaw_after_runs={m.get('thaw_after_runs')}")
    print(f"  reason: {m.get('reason', '')[:200]}")
    print("\nAllowed:")
    for a in m.get("allowed", []):
        print(f"  + {a}")
    print("\nForbidden:")
    for fb in m.get("forbidden", []):
        print(f"  - {fb}")
    # If argument given, try to classify
    if len(argv) > 1:
        query = " ".join(argv[1:]).lower()
        print(f"\nChecking: \"{query}\"")
        for fb in m.get("forbidden", []):
            if any(kw in query for kw in fb.lower().split()):
                print(f"  FORBIDDEN per rule: {fb}")
                return 1
        print("  LIKELY PERMITTED (no forbidden-rule keyword match; confirm manually)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
