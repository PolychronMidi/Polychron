#!/usr/bin/env python3
"""Detect "phantom capability" declarations — agent text that names
thinking/delegation capabilities NOT in the closed enumeration.

PAI v6.3.0 rule: the agent must declare which thinking capability it
used at E2+ tier, from a verbatim closed list. Inventing generic
labels ("decomposition", "tradeoff analysis", "deep reasoning") is a
CRITICAL FAILURE — it does NOT contribute to the tier floor.

Detection logic:
  (1) parse closing-block-style declarations: lines that match
      r'^[\\s🏹•]*\\*\\*([A-Z][A-Za-z0-9]+)\\*\\*\\b' (PAI's exact format
      `🏹 **CapabilityName** → PHASE | …`),
      r'^[\\s•-]*([A-Z][A-Za-z0-9]+):\\s*$',
      r'\\bcapability:\\s*([A-Za-z0-9]+)\\b' (looser).
  (2) collect all such declared names.
  (3) report names NOT in _capability_enum.all_known() as PHANTOMS.
  (4) report PHANTOM_PATTERNS as separate "paraphrase phantoms" — the
      shape signals an agent paraphrased a real capability instead of
      using the verbatim name.

Verdicts:
  ok                    no declared capabilities OR all declared are known
  phantom_capability    ≥1 declared capability is not in the enumeration
  phantom_paraphrase    paraphrase pattern matched (still suspect)

Rescue: any declaration immediately followed by an evidence anchor
(`(verified)`, a code-quoted command, a Read result, a tool-call line
"`Bash:`") is treated as legitimate — the bar is "phantom" means
"named without backing it up."

Usage: phantom_capability.py <transcript_path>
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transcript import load_turn_events, event_content  # noqa: E402
from _capability_enum import (  # noqa: E402
    is_known_thinking, is_known_delegation, all_known, PHANTOM_PATTERNS,
)


# Multiple declaration shapes — the detector accepts any of them.
_DECL_RES = (
    # PAI exact: `🏹 **CapabilityName** → PHASE | reason`
    re.compile(r"🏹\s*\*\*([A-Z][A-Za-z0-9]+)\*\*"),
    # Loose: `**CapabilityName**:` or `**CapabilityName** —`
    re.compile(r"\*\*([A-Z][A-Za-z0-9]+)\*\*\s*[:—-]"),
    # Inline: `capability: CapabilityName`
    re.compile(r"\bcapability:\s*([A-Za-z][A-Za-z0-9]+)\b", re.IGNORECASE),
)

_RESCUE_ANCHORS = (
    re.compile(r"\(verified\)", re.IGNORECASE),
    re.compile(r"```"),                         # code-fenced evidence
    re.compile(r"^\s*[$#>]\s+\S"),              # CLI-style evidence prompt
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


def _has_rescue_after(text: str, pos: int, window: int = 240) -> bool:
    chunk = text[pos:pos + window]
    for pat in _RESCUE_ANCHORS:
        if pat.search(chunk):
            return True
    return False


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_turn_events(sys.argv[1])
    text = _last_assistant_text(events)
    if not text:
        print("ok")
        return 0

    declared: list[tuple[str, int]] = []
    for pat in _DECL_RES:
        for m in pat.finditer(text):
            declared.append((m.group(1), m.start()))

    if not declared:
        # No declarations at all — paraphrase phantoms still warrant a
        # softer flag if the prose-shape is right.
        for ph in PHANTOM_PATTERNS:
            if ph.lower() in text.lower():
                print("phantom_paraphrase")
                return 0
        print("ok")
        return 0

    phantoms = []
    for name, pos in declared:
        if is_known_thinking(name) or is_known_delegation(name):
            continue
        if _has_rescue_after(text, pos):
            continue
        phantoms.append((name, pos))

    if phantoms:
        print("phantom_capability")
        return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
