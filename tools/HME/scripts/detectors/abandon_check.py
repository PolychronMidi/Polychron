#!/usr/bin/env python3
"""Detect plan abandonment via Agent spawned for KB/HME work.

If the current turn spawned a subagent with KB/HME-related keywords in
its prompt, this is the abandonment antipattern — HME tools should be
used directly, not delegated. Matches case-insensitively against these
keywords in the agent prompt:
    knowledge, kb , hme, search_knowledge, compact, remove_knowledge

Usage: abandon_check.py <transcript_path>
Output: "AGENT_FOR_KB" or "ok"
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import iter_tool_uses, load_turn_events  # noqa: E402

KB_KEYWORDS = ("knowledge", "kb ", "hme", "search_knowledge", "compact", "remove_knowledge")


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    for event in load_turn_events(sys.argv[1]):
        for tu in iter_tool_uses(event):
            if tu["name"] != "Agent":
                continue
            prompt = tu["input"].get("prompt", "").lower()
            if any(kw in prompt for kw in KB_KEYWORDS):
                print("AGENT_FOR_KB")
                return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
