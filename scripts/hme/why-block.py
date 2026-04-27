#!/usr/bin/env python3
"""i/why mode=block — explain the most recent hook/policy block.

Reads:
- log/hme-errors.log (recent block reasons)
- log/hme.log (broader context around the block)
- hme-activity.jsonl (events that surround the block)

Output: the last block message + which policy/hook fired + the
preceding tool call shape, so the agent can model "why did the
system stop me" without grepping logs themselves.
"""
from __future__ import annotations
import os
import re
import sys

from _common import PROJECT_ROOT


def _tail(path: str, n: int) -> list[str]:
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            return f.readlines()[-n:]
    except OSError:
        return []


def main(argv):
    err_log = os.path.join(PROJECT_ROOT, "log", "hme-errors.log")
    main_log = os.path.join(PROJECT_ROOT, "log", "hme.log")

    err_tail = _tail(err_log, 50)
    block_lines = [
        ln for ln in err_tail
        if "BLOCKED" in ln or "deny" in ln.lower() or "exit 2" in ln
    ]
    if not block_lines:
        print("# i/why mode=block")
        print("No recent block events found in log/hme-errors.log.")
        print("If a block fired this turn, check log/hme.log for the policy name.")
        return 0

    print("# i/why mode=block — most recent block events")
    for ln in block_lines[-5:]:
        print(f"  {ln.rstrip()}")
    print()

    main_tail = _tail(main_log, 100)
    policy_lines = [ln for ln in main_tail if "policy" in ln.lower() or "hook" in ln.lower()]
    if policy_lines:
        print("# Surrounding policy/hook context (last 5):")
        for ln in policy_lines[-5:]:
            print(f"  {ln.rstrip()}")

    print()
    print("# Diagnose:")
    print("  i/policies list                       # see which policies are active")
    print("  i/policies show <name>                # full policy definition")
    print("  i/policies disable <name>             # opt out (project/local/global scope)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
