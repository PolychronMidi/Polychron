#!/usr/bin/env python3
"""Detect premature stop / dismissive text-only final turn.

Looks at the LAST assistant message. Prints:
  - "DISMISSIVE" if the text contains phrases like "no response requested",
    "nothing to do", "all done", etc.
  - "TEXT_ONLY_SHORT" if there are no tool_use blocks and the combined text
    is < 200 characters.
  - "ok" otherwise.

Usage: stop_work.py <transcript_path>
Output: "DISMISSIVE" | "TEXT_ONLY_SHORT" | "ok"
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import last_assistant_event, event_content  # noqa: E402

DISMISSIVE_PHRASES = (
    "no response requested",
    "nothing to do",
    "no action needed",
    "no further action",
    "no work remaining",
    "all done",
)


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    event = last_assistant_event(sys.argv[1])
    if not event:
        print("ok")
        return 0
    blocks = event_content(event)
    has_tool_use = any(
        isinstance(b, dict) and b.get("type") == "tool_use" for b in blocks
    )
    text_parts = [
        b.get("text", "") for b in blocks
        if isinstance(b, dict) and b.get("type") == "text"
    ]
    full_text = " ".join(text_parts).strip().lower()
    if any(d in full_text for d in DISMISSIVE_PHRASES):
        print("DISMISSIVE")
    elif not has_tool_use and len(full_text) < 200:
        print("TEXT_ONLY_SHORT")
    else:
        print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
