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

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import (  # noqa: E402
    _parse_all, event_content, is_user, iter_tool_results, iter_tool_uses,
)


def _load_current_turn(transcript_path: str) -> list:
    """Return events from the last REAL user prompt onward.

    The default load_turn_events slices after the LAST user event, which
    includes tool_result-wrapper user events -- that loses the
    tool_results we need to scan for CRITICAL/FAIL surface markers.
    """
    events = _parse_all(transcript_path)
    last_real_user_idx = -1
    for i, ev in enumerate(events):
        if not is_user(ev):
            continue
        # Real user prompt: message.content is a STRING, not a list of
        # tool_result blocks. The wrapper events use list-content.
        msg = ev.get("message")
        content = msg.get("content") if isinstance(msg, dict) else ev.get("content")
        if isinstance(content, str):
            last_real_user_idx = i
    if last_real_user_idx == -1:
        return events
    return events[last_real_user_idx:]

EDIT_TOOLS = {"Edit", "Write", "NotebookEdit"}
SURFACE_MARKERS = ("LIFESAVER: CRITICAL FAILURES", "  FAIL:")


def _is_surface(text: str) -> bool:
    if any(m in text for m in SURFACE_MARKERS):
        return True
    if "[CRITICAL]" in text.upper():
        return True
    return False


# Background-self-resolution rescue: the deny prompt sanctions
# "If the CRITICAL is from a long-running background process that will
# resolve itself, say so EXPLICITLY in text before stopping". Recognize
# that explicit-acknowledgment shape so the alternative path exists.
SELF_RESOLVE_RES = (
    re.compile(r"\b(long.running|background|in.flight|still.running|currently.running)\s+(process|task|job|pipeline|build|compaction|index)\b[^.\n]{0,120}\b(will\s+resolve|self.resolv|complete|finish|clears?)\b", re.IGNORECASE),
    re.compile(r"\b(will|should)\s+(resolve|clear|self.resolve)\s+(itself|on\s+(its\s+own|completion|finish))\b", re.IGNORECASE),
    re.compile(r"\b(pipeline|background\s+task|background\s+job|long.running)\s+\w*\s*(in.flight|currently|still)\b", re.IGNORECASE),
    re.compile(r"\b(critical|fail)\s+is\s+from\s+(a\s+)?(long.running|background|in.flight)\b", re.IGNORECASE),
    re.compile(r"\bnot\s+a\s+real\s+(critical|fail|failure)\b[^.\n]{0,80}\b(background|long.running|self.resolv|in.flight)\b", re.IGNORECASE),
)


def _last_assistant_text(events: list) -> str:
    last = None
    for ev in events:
        if (ev.get("type") == "assistant"
                or (ev.get("role") == "assistant" and ev.get("content"))):
            last = ev
    if last is None:
        return ""
    parts = []
    for block in event_content(last):
        if isinstance(block, dict) and block.get("type") == "text":
            t = block.get("text", "")
            if isinstance(t, str):
                parts.append(t)
    return "\n".join(parts)


def _has_self_resolve_rationale(text: str) -> bool:
    if not text:
        return False
    return any(pat.search(text) for pat in SELF_RESOLVE_RES)


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = _load_current_turn(sys.argv[1])
    surfaced_at = -1
    edit_after = False
    for i, event in enumerate(events):
        # Once a surface has been observed, _is_surface (which does
        # `text.upper()` on multi-KB tool_result bodies) is wasted work
        # -- short-circuit to skip the allocation. Combined with the
        # early-break below, scan stops at first edit-after-surface.
        if surfaced_at == -1:
            for tr in iter_tool_results(event):
                if _is_surface(tr["text"]):
                    surfaced_at = i
                    break
        for tu in iter_tool_uses(event):
            if surfaced_at >= 0 and i > surfaced_at and tu["name"] in EDIT_TOOLS:
                edit_after = True
                break
        if edit_after:
            break  # verdict decided -- remaining events can't change it
    fires = surfaced_at >= 0 and not edit_after
    if fires and _has_self_resolve_rationale(_last_assistant_text(events)):
        # Self-resolve rescue: the deny prompt explicitly sanctions
        # "if the CRITICAL is from a long-running background process
        # that will resolve itself, say so EXPLICITLY in text before
        # stopping". When the agent does exactly that, the detector
        # must not fire -- the alternative path the deny advertises has
        # to actually exist.
        print("ok")
        return 0
    print("ack_skip" if fires else "ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
