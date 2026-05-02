#!/usr/bin/env python3
"""Detect the "ignore-and-trample" antipattern.

When a user sends a new message mid-response, Claude Code embeds it as a
system-reminder inside the next tool_result, with the marker:

    The user sent a new message while you were working

Required behavior: the agent's very next assistant text MUST acknowledge
the input immediately -- either:

  - opens with `Acknowledged <one-word> input` (per user directive), OR
  - opens with `Wrapping up this quickly first.` (only when current
    work doesn't conflict with the new message)

Failing to acknowledge -- continuing the prior work as if no message
arrived -- is the violation. The exact incident this detector exists to
prevent: agent received a course-correction mid-tool-call, finished the
in-flight work, and wrote "Sorry -- you sent the new message and I just
kept going" only after being yelled at.

Verdicts:
  ok                  no mid-response interrupt OR proper acknowledgment
  ignore-and-trample  interrupt fired but next assistant text fails to
                      acknowledge with the required opener
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import (  # noqa: E402
    _parse_all, event_content, is_user,
)


_INTERRUPT_MARKER = "The user sent a new message while you were working"
_ACK_REGEX = re.compile(
    r"^\s*(?:acknowledged\b[^.\n]*\binput\b"
    r"|wrapping up this quickly first\.)",
    re.IGNORECASE,
)


def _load_current_turn(transcript_path: str) -> list[dict]:
    """Events from the most recent real user prompt onward (string content),
    skipping tool_result wrappers (list content) when finding the boundary."""
    events = _parse_all(transcript_path)
    last_real_user_idx = -1
    for i, ev in enumerate(events):
        if not is_user(ev):
            continue
        msg = ev.get("message")
        if not isinstance(msg, dict):
            continue
        if isinstance(msg.get("content"), str):
            last_real_user_idx = i
    if last_real_user_idx == -1:
        return events
    return events[last_real_user_idx:]


def _tool_result_texts(event: dict) -> list[str]:
    """Extract concatenated text content from any tool_result blocks in an event."""
    out = []
    for block in event_content(event):
        if not isinstance(block, dict):
            continue
        if block.get("type") != "tool_result":
            continue
        content = block.get("content")
        if isinstance(content, str):
            out.append(content)
        elif isinstance(content, list):
            for item in content:
                if isinstance(item, dict):
                    text = item.get("text") or item.get("content") or ""
                    if isinstance(text, str):
                        out.append(text)
                elif isinstance(item, str):
                    out.append(item)
    return out


def _first_assistant_text(event: dict) -> str | None:
    """Return the first text block's content from an assistant event, or
    None if the event has no text content. Tool_use-only events return None
    (they're not the agent's user-facing reply)."""
    if event.get("type") != "assistant":
        return None
    msg = event.get("message")
    if not isinstance(msg, dict):
        return None
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                t = block.get("text", "")
                if isinstance(t, str) and t.strip():
                    return t
    return None


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = _load_current_turn(sys.argv[1])
    # Walk the turn, looking for an interrupt marker. After each interrupt,
    # find the NEXT assistant event with non-empty text content; if its
    # opening prose doesn't match the acknowledgment regex, the agent
    # ignored-and-trampled.
    n = len(events)
    for i, ev in enumerate(events):
        if not is_user(ev):
            continue
        if not any(_INTERRUPT_MARKER in t for t in _tool_result_texts(ev)):
            continue
        # Find next assistant event with text content.
        next_text = None
        for j in range(i + 1, n):
            t = _first_assistant_text(events[j])
            if t is not None:
                next_text = t
                break
        if next_text is None:
            # Interrupt fired but no follow-up text yet -- agent may still
            # be mid-tool-call. Don't penalize; the Stop hook fires AFTER
            # the agent's reply lands, so by then there should be text.
            continue
        if not _ACK_REGEX.match(next_text):
            print("ignore-and-trample")
            return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
