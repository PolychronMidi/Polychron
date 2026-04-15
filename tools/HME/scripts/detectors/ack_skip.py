#!/usr/bin/env python3
"""Detect acknowledge-and-move-on antipattern.

Fires when an HME tool in this turn surfaced a LIFESAVER CRITICAL/FAIL
and no Edit/Write/NotebookEdit tool_use happened after the surface.
The rule is "fix it, don't just note it."

Surface tokens checked (case-sensitive for LIFESAVER, case-insensitive for CRITICAL):
  - "LIFESAVER: CRITICAL FAILURES"
  - "[CRITICAL]" (any casing)
  - "  FAIL:" (two-space indent; matches selftest FAIL rows)

Usage: ack_skip.py <transcript_path>
Output: "ack_skip" or "ok"
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import iter_tool_results, iter_tool_uses, load_turn_events  # noqa: E402

EDIT_TOOLS = {"Edit", "Write", "NotebookEdit"}
SURFACE_MARKERS = ("LIFESAVER: CRITICAL FAILURES", "  FAIL:")


def _is_surface(text: str) -> bool:
    if any(m in text for m in SURFACE_MARKERS):
        return True
    if "[CRITICAL]" in text.upper():
        return True
    return False


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_turn_events(sys.argv[1])
    surfaced_at = -1
    edit_after = False
    for i, event in enumerate(events):
        for tr in iter_tool_results(event):
            if _is_surface(tr["text"]) and surfaced_at == -1:
                surfaced_at = i
        for tu in iter_tool_uses(event):
            if surfaced_at >= 0 and i > surfaced_at and tu["name"] in EDIT_TOOLS:
                edit_after = True
    print("ack_skip" if surfaced_at >= 0 and not edit_after else "ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
