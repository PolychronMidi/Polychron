#!/usr/bin/env python3
"""Detect "enumerated remaining items as deferral" antipattern.

Sister of early_stop.py. early_stop is *gated* on an open-ended user prompt
("do all", "anything missing", etc.) — it catches the historical pattern
where the agent enumerates work and then stops in response to those prompts.

This detector is *unconditional*: ANY final assistant text that ends with an
explicit "remaining items / not fixed / TBD / noted" list is flagged,
regardless of how the user phrased the request. Born from the failure where
the user asked an open-ended question, the agent produced ten fixes, then
closed with `## Remaining non-ecstatic tools (noted, not yet fixed)` and
five bullets — early_stop's enumeration list missed those exact phrasings.

Trigger: assistant's FINAL text contains BOTH:
  (a) any DEFERRAL phrase (e.g. "noted, not yet fixed", "TBD",
      "remaining tools", "not yet implemented"), AND
  (b) an enumerated bullet list (3+ markdown bullets `- ` or `* ` after the
      deferral phrase) — proves the deferral wasn't a passing mention but
      a literal hand-off of work.

Usage: exhaust_check.py <transcript_path>
Output: "exhaust_violation" or "ok"
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import load_full_turn_with_user  # noqa: E402


# Phrases that explicitly mark an item as "not done in this turn".
# These should never appear in a closing summary — every enumerated item
# must be either completed or punted with explicit user agreement.
DEFERRAL_PHRASES = (
    "noted not fixed",
    "noted, not fixed",
    "noted not yet fixed",
    "noted, not yet fixed",
    "noted as remaining",
    "remaining tools",
    "remaining items",
    "remaining work",
    "remaining issues",
    "remaining gaps",
    "remaining non-ecstatic",
    "still not fixed",
    "not fixed yet",
    "not yet fixed",
    "not yet implemented",
    "not yet addressed",
    "not yet handled",
    "tbd:",
    "tbd ",
    "(tbd)",
    "[tbd]",
    "to-do:",
    "to do:",
    "todo:",
    "deferred:",
    "deferred to next",
    "punt to next",
    "skipped (not blocking)",
    "left for later",
    "for a future turn",
    "in a follow-up",
    "follow-up turn",
    "next turn could",
    "needs follow-up",
    "for next session",
    "future work:",
)

# A run of 3+ bullet lines = a literal enumeration handed off.
_BULLET_LINE = re.compile(r"^\s*[-*•]\s+\S", re.MULTILINE)


def _is_assistant(event: dict) -> bool:
    return event.get("role") == "assistant" and bool(event.get("content"))


def _last_assistant_text(events: list) -> str:
    last = None
    for ev in events:
        if _is_assistant(ev):
            last = ev
    if last is None:
        return ""
    parts = []
    for block in last.get("content", []) or []:
        if isinstance(block, dict) and block.get("type") == "text":
            t = block.get("text", "")
            if isinstance(t, str):
                parts.append(t)
    return "\n".join(parts)


def _emit_stats(verdict: str, detail: str) -> None:
    """Best-effort telemetry. Mirrors early_stop's emit pattern."""
    import json as _json
    import os as _os
    import time as _time
    try:
        root = _os.environ.get("PROJECT_ROOT")
        if not root:
            here = Path(__file__).resolve()
            for parent in [here.parent, *here.parents]:
                if (parent / "CLAUDE.md").exists() and (parent / ".env").exists():
                    root = str(parent)
                    break
        if not root:
            return
        out = _os.path.join(root, "output", "metrics", "detector-stats.jsonl")
        _os.makedirs(_os.path.dirname(out), exist_ok=True)
        with open(out, "a", encoding="utf-8") as f:
            f.write(_json.dumps({
                "ts": _time.time(),
                "detector": "exhaust_check",
                "verdict": verdict,
                "detail": detail,
            }) + "\n")
    except Exception:  # silent-ok: telemetry only, never block hook
        pass


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_full_turn_with_user(sys.argv[1])
    text = _last_assistant_text(events)
    if not text:
        _emit_stats("ok", "no_final_text")
        print("ok")
        return 0

    text_l = text.lower()

    # Find any deferral phrase. Record the EARLIEST position so we can
    # check whether bullets follow it (proving enumeration of deferred work).
    matched_phrase = None
    matched_pos = -1
    for phrase in DEFERRAL_PHRASES:
        idx = text_l.find(phrase)
        if idx != -1 and (matched_pos == -1 or idx < matched_pos):
            matched_phrase = phrase
            matched_pos = idx
    if matched_phrase is None:
        _emit_stats("ok", "no_deferral_phrase")
        print("ok")
        return 0

    # Count bullet lines AFTER the first deferral phrase. 3+ = real
    # enumeration; <3 = passing mention worth letting through.
    after = text[matched_pos:]
    bullet_count = sum(1 for _ in _BULLET_LINE.finditer(after))
    if bullet_count < 3:
        _emit_stats("ok", f"deferral={matched_phrase!r} but only {bullet_count} bullets after it")
        print("ok")
        return 0

    _emit_stats("exhaust_violation",
                f"deferral={matched_phrase!r} bullets_after={bullet_count}")
    print("exhaust_violation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
