#!/usr/bin/env python3
"""Count wait-and-poll tool calls in the current turn.

Detects two forms of the same antipattern:
  - Bash commands reading /tasks/<id>.output files (background task polling)
  - Repeated mcp__HME__check_pipeline calls

Prints the max of the two counts. stop.sh blocks when >= 2.

Usage: poll_count.py <transcript_path>
Output: single integer on stdout (0 if missing/empty).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import iter_tool_uses, load_turn_events  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print("0")
        return 0
    bash_polls = 0
    mcp_polls = 0
    for event in load_turn_events(sys.argv[1]):
        for tu in iter_tool_uses(event):
            name = tu["name"]
            if name == "Bash":
                cmd = tu["input"].get("command", "")
                if "/tasks/" in cmd and ".output" in cmd:
                    bash_polls += 1
            elif name == "mcp__HME__check_pipeline":
                mcp_polls += 1
    print(max(bash_polls, mcp_polls))
    return 0


if __name__ == "__main__":
    sys.exit(main())
