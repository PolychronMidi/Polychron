#!/usr/bin/env python3
"""Pile-on antipattern detector.

The failure mode this catches: an agent endlessly tweaks rules instead of
exercising discretion. Each detector firing produces another rule edit;
each rule edit creates new firings; the cycle accumulates ceremony
without resolving the underlying issue. The user's diagnosis: "treating
yourself like a retarded petulant toddler" -- demanding infinite
enforcement instead of having an ounce of judgment.

Detection heuristic: a single turn that Edits/Writes >=2 distinct files
under the detector / policy / hook directories is shaped like pile-on.
Routine code changes touch one detector at a time; rapid cross-detector
edits in the same turn are the cascade-tweaking pattern.

This detector replaces ceremony_dodge (deleted -- it WAS pile-on).
Where ceremony_dodge tried to catch text-shaped dodges via more regex,
pile_on catches the meta-pattern (rule-stacking) directly.

Verdicts:
  ok               <2 detector/policy/hook edits this turn
  pile_on          >=2 distinct detector/policy/hook files edited in
                   the current turn -- the agent is rule-stacking instead
                   of exercising discretion

Rescue: there is no rescue. The fix is to STOP editing detectors and
let the existing rules be imperfect. Detectors are best-effort signal,
not absolute ground truth. When in doubt, the agent should exercise
discretion rather than engineer another guardrail.

Usage: pile_on.py <transcript_path>
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transcript import load_turn_events, iter_tool_uses  # noqa: E402

_PILE_ON_PATHS = re.compile(
    r"tools/HME/scripts/detectors/[^/]+\.py$|"
    r"tools/HME/proxy/stop_chain/policies/[^/]+\.js$|"
    r"tools/HME/hooks/lifecycle/stop/[^/]+\.sh$",
)
_EDIT_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}


def _detector_files_touched(events: list) -> set[str]:
    """Distinct detector / policy / hook files Edited / Written this turn."""
    out: set[str] = set()
    for ev in events:
        for tu in iter_tool_uses(ev):
            if tu.get("name") not in _EDIT_TOOLS:
                continue
            path = (tu.get("input") or {}).get("file_path", "") or ""
            if _PILE_ON_PATHS.search(path):
                out.add(path)
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_turn_events(sys.argv[1])
    touched = _detector_files_touched(events)
    if len(touched) >= 2:
        print("pile_on")
        return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
