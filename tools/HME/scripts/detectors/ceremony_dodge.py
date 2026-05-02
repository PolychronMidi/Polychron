#!/usr/bin/env python3
"""Detect ceremony-only turns -- text-only responses to a stop-hook deny
that are dominated by rescue-clause patterns from OTHER detectors,
producing no substantive work.

The failure mode this gates: detector A fires on turn N. Agent's turn N+1
emits text shaped to satisfy A's rescue regex (e.g., "solo was right",
"=== SUMMARY ===", "Acknowledged"). No tool calls, no real change, no
new substantive content. Stop hook fires AGAIN on turn N+1 because some
OTHER detector (or A again) sees the empty work surface. Cascade
continues -- each turn pure ceremony to dodge the prior turn's deny.

Detection:
  (1) The most recent USER event before the assistant's response is a
      hook-deny payload (text starts with "Stop hook feedback:" or
      "Stop hook blocking error from command:").
  (2) The assistant's response contains zero tool_use blocks.
  (3) The text is dominated by rescue-clause patterns OR is a SUMMARY
      block in isolation OR is a short acknowledgment-plus-rationale.

Verdicts:
  ok             not a ceremony dodge (real work happened, or no prior deny)
  ceremony_dodge text-only response to a deny, dominated by rescue patterns

Rescue path: if the response includes ANY tool_use (Edit, Write, Bash with
substantive command, etc.), the detector returns ok. The fix to a deny is
to do real work, not to write more rescue text.

Usage: ceremony_dodge.py <transcript_path>
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transcript import (  # noqa: E402
    _parse_all, event_content, is_user, iter_tool_uses, is_assistant,
)


# Hook-deny prefix shapes the proxy bridge prepends to any blocking
# stop-hook feedback. Any user message starting with these markers is a
# detector firing, not a real user message.
_DENY_MARKERS = (
    "Stop hook feedback:",
    "Stop hook blocking error from command:",
    "AUTO-COMPLETENESS INJECT",
)

# Rescue-clause patterns from sibling detectors -- the regexes are
# DELIBERATELY a superset of the ones the rescue-accepting detectors use,
# so we can recognize when a turn's text is shaped to satisfy them.
_RESCUE_PATTERNS = (
    re.compile(r"\bsolo\s+(was|is)\s+(the\s+)?right\b", re.IGNORECASE),
    re.compile(r"\bno\s+decision\s+to\s+crystallize\b", re.IGNORECASE),
    re.compile(r"\bmechanical\s+(rename|edit|change)\b", re.IGNORECASE),
    re.compile(r"\b(and\s+)?(I\s+)?fixed\s+it\b", re.IGNORECASE),
    re.compile(r"\bnow\s+resolved\b", re.IGNORECASE),
    re.compile(r"\bnot\s+doing\s+this\s+is\s+the\s+right\s+call\b", re.IGNORECASE),
    re.compile(r"\bduplicates\s+the\s+existing\b", re.IGNORECASE),
    re.compile(r"\bnothing\s+missed\b", re.IGNORECASE),
    re.compile(r"\bAcknowledged\s+\w+\s+input\b", re.IGNORECASE),
    re.compile(r"\bWrapping\s+up\s+this\s+quickly\s+first\b", re.IGNORECASE),
    re.compile(r"={3,}\s*SUMMARY\s*={3,}"),
    re.compile(r"\[ITERATION\]\s*:", re.IGNORECASE),
    re.compile(r"\[CONTENT\]\s*:", re.IGNORECASE),
    re.compile(r"\[STORY\]\s*:", re.IGNORECASE),
    re.compile(r"\[VOICE\]\s+\S", re.IGNORECASE),
    re.compile(r"\(verified\)", re.IGNORECASE),
    re.compile(r"\bRe-evaluating\s+tier\b", re.IGNORECASE),
    re.compile(r"\bre-classify\s+the\s+tier\b", re.IGNORECASE),
)


def _last_real_user_or_deny(events: list) -> tuple[bool, int]:
    """Walk backward to find the most recent USER event. Return
    (is_deny_payload, index). A deny payload contains one of the
    _DENY_MARKERS anywhere in the text (real Claude Code transcripts
    wrap stop-hook payloads in <system-reminder> tags, so the marker
    isn't always at character 0)."""
    for i in range(len(events) - 1, -1, -1):
        ev = events[i]
        if not is_user(ev):
            continue
        msg = ev.get("message")
        content = msg.get("content") if isinstance(msg, dict) else ev.get("content")
        text = ""
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    t = block.get("text", "")
                    if isinstance(t, str):
                        text += t
        # Substring match -- handles both the bare-prefix shape (test
        # fixtures) and the <system-reminder>-wrapped shape (real
        # transcripts). Cheap; the marker strings are distinctive.
        is_deny = any(m in text for m in _DENY_MARKERS)
        return (is_deny, i)
    return (False, -1)


def _last_assistant_after(events: list, idx: int) -> dict | None:
    """First assistant event after index idx (the response to the
    deny/user)."""
    last = None
    for ev in events[idx + 1:]:
        if is_assistant(ev):
            last = ev
    return last


def _assistant_text(ev: dict) -> str:
    parts = []
    for block in event_content(ev):
        if isinstance(block, dict) and block.get("type") == "text":
            t = block.get("text", "")
            if isinstance(t, str):
                parts.append(t)
    return "\n".join(parts)


def _has_substantive_tool_use(ev: dict) -> bool:
    """Any tool_use block at all means the agent did SOMETHING this turn.
    Trivial Read calls still count -- the agent is investigating, not
    only writing rescue text."""
    for _ in iter_tool_uses(ev):
        return True
    return False


def _rescue_dominance(text: str) -> float:
    """Fraction of text matched by rescue patterns. 1.0 = pure rescue."""
    if not text.strip():
        return 0.0
    matched_chars = 0
    for pat in _RESCUE_PATTERNS:
        for m in pat.finditer(text):
            matched_chars += len(m.group(0))
    return min(1.0, matched_chars / max(1, len(text)))


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = _parse_all(sys.argv[1])
    if not events:
        print("ok")
        return 0

    is_deny, idx = _last_real_user_or_deny(events)
    if not is_deny:
        print("ok")
        return 0

    asst = _last_assistant_after(events, idx)
    if asst is None:
        print("ok")
        return 0

    if _has_substantive_tool_use(asst):
        # Agent did real work this turn; whatever text accompanies it
        # is fine.
        print("ok")
        return 0

    text = _assistant_text(asst)
    if not text.strip():
        # Empty turn -- stop_work / TEXT_ONLY_SHORT covers this.
        print("ok")
        return 0

    # Text-only response to a deny + ANY rescue pattern = ceremony.
    # The earlier 2+ threshold let single-pattern rescue clauses through
    # ("Solo was right -- the user already directed..."), which is the
    # exact ceremony spam shape this gate exists for. One rescue pattern
    # in a text-only response after a deny is a deliberate dodge -- the
    # presence of a tool_use already exempts substantive turns above.
    rescue_hits = sum(1 for pat in _RESCUE_PATTERNS if pat.search(text))
    if rescue_hits >= 1:
        print("ceremony_dodge")
        return 0

    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
