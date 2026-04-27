#!/usr/bin/env python3
"""i/why mode=state — explain the current onboarding state and what
advanced HME into it.

Reads:
- tmp/hme-onboarding.state (current state)
- output/metrics/hme-activity.jsonl (events that drove transitions)
- doc/HME_ONBOARDING_FLOW.md (state-machine reference, optional)

Output: current state, what tool calls advance it, what would graduate.
"""
from __future__ import annotations
import json
import os
import sys

from _common import PROJECT_ROOT


_STATE_DESC = {
    "boot":        "Fresh session. Forward: i/hme-admin action=selftest with zero FAIL.",
    "selftest_ok": "Selftest passed. Forward: i/evolve focus=design (or any focus= picking a target).",
    "targeted":    "Evolution target picked. Forward: Edit on any /src/ file (briefing auto-chains).",
    "edited":      "Edit applied. Forward: i/review mode=forget with no warnings.",
    "reviewed":    "Review clean. Forward: Bash npm run main (run_in_background=true).",
    "piped":       "Pipeline running. Forward: STABLE/EVOLVED verdict from fingerprint-comparison.json.",
    "verified":    "Pipeline passed. Forward: i/learn title=… content=… (both non-empty) → graduates.",
    "graduated":   "Onboarding complete; gates relax. State file deleted; bypass mode active.",
}


def main(argv):
    state_file = os.path.join(PROJECT_ROOT, "tmp", "hme-onboarding.state")
    state = "graduated"
    if os.path.isfile(state_file):
        try:
            with open(state_file) as f:
                state = f.read().strip() or "graduated"
        except OSError:
            pass

    print(f"# i/why mode=state — onboarding state")
    print()
    print(f"  Current state: {state}")
    print(f"  Meaning: {_STATE_DESC.get(state, '(unknown state)')}")
    print()

    activity_file = os.path.join(PROJECT_ROOT, "output", "metrics", "hme-activity.jsonl")
    if os.path.isfile(activity_file):
        try:
            with open(activity_file) as f:
                lines = f.readlines()[-50:]
            transitions = []
            for ln in lines:
                try:
                    e = json.loads(ln)
                except ValueError:
                    continue
                if e.get("event") in ("state_advance", "onboarding_advance",
                                      "onboarding_init", "round_complete"):
                    transitions.append(e)
            if transitions:
                print(f"# Last {min(5, len(transitions))} transitions:")
                for e in transitions[-5:]:
                    ts = e.get("ts", "?")
                    ev = e.get("event", "?")
                    extra = e.get("from", e.get("session", ""))
                    to = e.get("to", "")
                    arrow = f" → {to}" if to else ""
                    print(f"  {ts}  {ev}  {extra}{arrow}")
                print()
        except OSError:
            pass

    print("# Reference:")
    print("  doc/HME_ONBOARDING_FLOW.md          full state machine spec")
    print("  i/status mode=hme                   live state + recent activity")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
