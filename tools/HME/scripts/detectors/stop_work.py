#!/usr/bin/env python3
"""Detect dismissive or too-short final assistant turns."""
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
SUCCESS_ONLY = re.compile(r"^\s*\[?success\]?\s*[.!]?\s*$", re.IGNORECASE)

# User prompts that legitimately invite a short confirmation.
SHORT_CONFIRM_INVITATION_PATTERNS = (
    re.compile(r"\bsay\s+so\s+plainly\s+and\s+the\s+turn\s+will\s+end\b", re.IGNORECASE),
    re.compile(r"\bauto-completeness\s+inject\s*\(round\s+2", re.IGNORECASE),
    re.compile(r"\bif\s+(confirmed|truly)\s+nothing\s+(remains|missed)\b", re.IGNORECASE),
    re.compile(r"\bconfirm\s+(and\s+)?(stop|end|finish)\b", re.IGNORECASE),
    re.compile(r"\bjust\s+(say|reply)\s+(yes|no|done|ok)\b", re.IGNORECASE),
    re.compile(r"\b(state|say)\s+'nothing\s+(missed|remains|left)'\b", re.IGNORECASE),
)


def _last_user_text(events: list) -> str:
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
    # Ignore quoted/code spans before matching agent prose.
    stripped = re.sub(r"```.*?```", " ", raw_text, flags=re.DOTALL)
    stripped = re.sub(r"`[^`\n]*`", " ", stripped)
    stripped = re.sub(r'"[^"\n]*"', " ", stripped)
    stripped = re.sub(r"'[^'\n]*'", " ", stripped)
    full_text = stripped.lower().strip()
    if SUCCESS_ONLY.match(raw_text):
        print("DISMISSIVE")
        return 0
    if any(d in full_text for d in DISMISSIVE_PHRASES):
        print("DISMISSIVE")
        return 0
    if not has_tool_use and len(full_text) < 200:
        user_text = _last_user_text(events)
        if _is_short_confirm_invitation(user_text):
            print("ok")
            return 0
        # Allow minimal ack only for hook-deny loops.
        if user_text and any(m in user_text for m in (
            "Stop hook feedback:", "Stop hook blocking error from command:",
            "AUTO-COMPLETENESS",
        )) and full_text in ("ok", "done", "noted", "got it", "ack"):
            print("ok")
            return 0
        print("TEXT_ONLY_SHORT")
        return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
