#!/usr/bin/env python3
"""Pile-on antipattern detector.

The failure mode this catches: an agent stacks NEW detector / policy / hook files on top of an already-saturated rule layer. Each new rule creates new firings; each firing motivates more rules; the cycle accumulates ceremony without resolving the underlying issue.

What pile-on is NOT: editing existing detectors to fix bugs in them. Fixing a broken rule is not stacking another rule on top of it. The user clarified this multiple times: "PILE_ON IS ONLY ABOUT SPAMMING NEW DETECTORS, NOT ABOUT FIXING EXISTING ONES." A coherent multi-file fix touching N existing detectors is consolidation, the opposite of pile-on.

Detection heuristic: 2+ NEW (Write-not-Edit) files added under the detector / policy / hook directories in a single turn. Edits to existing files don't count regardless of count -- a single bug class can legitimately span multiple existing detectors.

Verdicts:
  ok               <2 NEW detector/policy/hook files written this turn
  pile_on          >=2 NEW (Write-not-Edit) detector/policy/hook files -- the agent is stacking new rules instead of fixing existing ones

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


def _new_files_added(touched: set[str], events: list) -> set[str]:
    """Subset of touched created via Write (not Edit). New detector/policy/hook
    files = stacked rules; edits to existing files = refinement, not stacking."""
    new_paths: set[str] = set()
    for ev in events:
        for tu in iter_tool_uses(ev):
            if tu.get("name") != "Write":
                continue
            path = (tu.get("input") or {}).get("file_path", "") or ""
            if path in touched:
                new_paths.add(path)
    return new_paths


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_turn_events(sys.argv[1])
    touched = _detector_files_touched(events)
    new_files = _new_files_added(touched, events)
    if len(new_files) >= 2:
        print("pile_on")
        return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
