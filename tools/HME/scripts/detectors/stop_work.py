#!/usr/bin/env python3
"""Detect premature stop / dismissive text-only final turn.

Looks at the LAST assistant message. Prints:
  - "DISMISSIVE" if the text contains phrases like "no response requested",
    "nothing to do", "all done", etc.
  - "TEXT_ONLY_SHORT" if there are no tool_use blocks and the combined text
    is < 200 characters.
  - "ok" otherwise.

EXEMPTION: when the user's most recent prompt is an explicit invitation to
a short confirmation response (AUTO-COMPLETENESS round-2 "say so plainly
and the turn will end", "confirm and stop", any direct yes/no question),
TEXT_ONLY_SHORT does NOT fire — a short confirmation is the correct
response shape, and forcing the agent to pad with tool calls or long
prose IS the antipattern this codebase's behavioral discipline rejects.
The DISMISSIVE classifier is unchanged — those phrases ("nothing to do",
"all done") are dismissive regardless of prompt context.

Usage: stop_work.py <transcript_path>
Output: "DISMISSIVE" | "TEXT_ONLY_SHORT" | "ok"
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import is_user, event_content, load_full_turn_with_user  # noqa: E402

DISMISSIVE_PHRASES = (
    "no response requested",
    "nothing to do",
    "no action needed",
    "no further action",
    "no work remaining",
    "all done",
)

# User-prompt patterns that explicitly invite a short confirmation reply.
# When matched, TEXT_ONLY_SHORT is exempted because brevity IS the
# correct response shape. Includes the AUTO-COMPLETENESS round-2 hook
# directive itself, which literally says "say so plainly and the turn
# will end" — forcing the agent to pad against that directive is the
# false-positive this exemption closes.
SHORT_CONFIRM_INVITATION_PATTERNS = (
    re.compile(r"\bsay\s+so\s+plainly\s+and\s+the\s+turn\s+will\s+end\b", re.IGNORECASE),
    re.compile(r"\bauto-completeness\s+inject\s*\(round\s+2", re.IGNORECASE),
    re.compile(r"\bif\s+(confirmed|truly)\s+nothing\s+(remains|missed)\b", re.IGNORECASE),
    re.compile(r"\bconfirm\s+(and\s+)?(stop|end|finish)\b", re.IGNORECASE),
    re.compile(r"\bjust\s+(say|reply)\s+(yes|no|done|ok)\b", re.IGNORECASE),
    re.compile(r"\b(state|say)\s+'nothing\s+(missed|remains|left)'\b", re.IGNORECASE),
)


def _last_user_text(events: list) -> str:
    """Extract the last user message's text. Mirrors the helper in
    exhaust_check.py — both detectors need the same user-prompt
    introspection to apply context-aware exemptions."""
    last_u = None
    for ev in events:
        if is_user(ev):
            last_u = ev
    if last_u is None:
        return ""
    parts = []
    for block in event_content(last_u):
        if isinstance(block, dict) and block.get("type") == "text":
            t = block.get("text", "")
            if isinstance(t, str):
                parts.append(t)
        elif isinstance(block, str):
            parts.append(block)
    msg = last_u.get("message")
    if isinstance(msg, dict):
        c = msg.get("content")
        if isinstance(c, str):
            parts.append(c)
        elif isinstance(c, list):
            for block in c:
                if isinstance(block, dict) and block.get("type") == "text":
                    t = block.get("text", "")
                    if isinstance(t, str):
                        parts.append(t)
    return "\n".join(parts)


def _is_short_confirm_invitation(user_text: str) -> bool:
    if not user_text:
        return False
    for pat in SHORT_CONFIRM_INVITATION_PATTERNS:
        if pat.search(user_text):
            return True
    return False


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_full_turn_with_user(sys.argv[1])
    # Find last assistant event from the loaded list (full turn including
    # the user message at index 0).
    last_a = None
    for ev in events:
        t = ev.get("type")
        r = ev.get("role")
        if t == "assistant" or (r == "assistant" and ev.get("content")):
            last_a = ev
    if not last_a:
        print("ok")
        return 0
    blocks = event_content(last_a)
    has_tool_use = any(
        isinstance(b, dict) and b.get("type") == "tool_use" for b in blocks
    )
    text_parts = [
        b.get("text", "") for b in blocks
        if isinstance(b, dict) and b.get("type") == "text"
    ]
    raw_text = " ".join(text_parts).strip()
    # Strip quoted / code-fenced spans before phrase matching — same
    # discipline as exhaust_check.py. Without this, a response that
    # describes a regex / quotes user prompt / shows code containing a
    # dismissive-phrase fragment (e.g. "All done" appearing inside a
    # regex example like `^(Nothing missed|...|All done|...)$`)
    # false-positives as a dismissive declaration. The patterns we
    # actually want to catch are bare phrases in the agent's own prose,
    # not quoted strings inside example/code/reference content.
    stripped = re.sub(r"```.*?```", " ", raw_text, flags=re.DOTALL)
    stripped = re.sub(r"`[^`\n]*`", " ", stripped)
    stripped = re.sub(r'"[^"\n]*"', " ", stripped)
    stripped = re.sub(r"'[^'\n]*'", " ", stripped)
    full_text = stripped.lower().strip()
    if any(d in full_text for d in DISMISSIVE_PHRASES):
        print("DISMISSIVE")
        return 0
    if not has_tool_use and len(full_text) < 200:
        # Exemption: short response to a short-confirmation invitation.
        user_text = _last_user_text(events)
        if _is_short_confirm_invitation(user_text):
            print("ok")
            return 0
        print("TEXT_ONLY_SHORT")
        return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
