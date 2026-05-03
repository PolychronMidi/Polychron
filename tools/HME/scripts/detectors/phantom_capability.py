#!/usr/bin/env python3
"""Detect "phantom capability" declarations -- agent text that names
thinking/delegation capabilities NOT in the closed enumeration.

PAI v6.3.0 rule: the agent must declare which thinking capability it
used at E2+ tier, from a verbatim closed list. Inventing generic
labels ("decomposition", "tradeoff analysis", "deep reasoning") is a
CRITICAL FAILURE -- it does NOT contribute to the tier floor.

Polychron's ASCII-first project rule replaces PAI's emoji declaration
prefix with a `[CAP]` text marker. Same role, regex-friendly, no Unicode.

Detection logic:
  (1) parse closing-block-style declarations:
      r'\\[CAP\\]\\s*\\*\\*([A-Z][A-Za-z0-9]+)\\*\\*\\b' (Polychron format
      `[CAP] **CapabilityName** -> PHASE | reason`),
      r'^[\\s*-]*([A-Z][A-Za-z0-9]+):\\s*$',
      r'\\bcapability:\\s*([A-Za-z0-9]+)\\b' (looser).
  (2) collect all such declared names.
  (3) report names NOT in _capability_enum.all_known() as PHANTOMS.
  (4) report PHANTOM_PATTERNS as separate "paraphrase phantoms" -- the
      shape signals an agent paraphrased a real capability instead of
      using the verbatim name.

Verdicts:
  ok                    no declared capabilities OR all declared are known
  phantom_capability    >=1 declared capability is not in the enumeration
  phantom_paraphrase    paraphrase pattern matched (still suspect)

Rescue: any declaration immediately followed by an evidence anchor
(`(verified)`, a code-quoted command, a Read result, a tool-call line
"`Bash:`") is treated as legitimate -- the bar is "phantom" means
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


# Multiple declaration shapes -- the detector accepts any of them.
_DECL_RES = (
    # Polychron format: `[CAP] **CapabilityName** -> PHASE | reason`
    re.compile(r"\[CAP\]\s*\*\*([A-Z][A-Za-z0-9]+)\*\*"),
    # Loose: `**CapabilityName**:` or `**CapabilityName** --`
    re.compile(r"\*\*([A-Z][A-Za-z0-9]+)\*\*\s*[:\-]"),
    # Inline: `capability: CapabilityName`
    re.compile(r"\bcapability:\s*([A-Za-z][A-Za-z0-9]+)\b", re.IGNORECASE),
)

_RESCUE_ANCHORS = (
    re.compile(r"\(verified\)", re.IGNORECASE),
    re.compile(r"```"),                         # code-fenced evidence
    re.compile(r"^\s*[$#>]\s+\S"),              # CLI-style evidence prompt
)


def _inside_backticks(text: str, idx: int) -> bool:
    """True if text[idx] is inside a `single` or ```triple``` backtick span.

    Counts triple-backticks first (they consume their own pair of singles),
    then single backticks. Odd count before idx = inside.
    """
    triples = 0
    i = 0
    while i < idx:
        if text[i:i + 3] == "```":
            triples += 1
            i += 3
        else:
            i += 1
    if triples % 2 == 1:
        return True
    # Strip triple-backtick regions before counting singles, otherwise
    # the singles inside a code fence would skew the parity.
    stripped_chars = 0
    in_triple = False
    j = 0
    singles_before = 0
    while j < idx:
        if text[j:j + 3] == "```":
            in_triple = not in_triple
            j += 3
            continue
        if not in_triple and text[j] == "`":
            singles_before += 1
        j += 1
    return singles_before % 2 == 1


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
        # No declarations at all -- paraphrase phantoms still warrant a
        # softer flag if the prose-shape is right. But skip occurrences
        # that are clearly QUOTED EXTERNAL TEXT (verbatim quotes from
        # source documents, headings, or shouted emphasis). Those are
        # not the agent reaching for a capability name; they're the
        # agent citing source material that happens to contain a
        # paraphrase-shaped phrase. Two cheap signals:
        #   (a) the matched span is ALL UPPERCASE in the original text
        #       -- shouting / heading shape, not capability claim
        #   (b) the matched span sits inside `backticks` or ```fence```
        #       -- code/literal-quote shape, not claim
        # Both are tight enough to avoid letting real paraphrase claims
        # slip through (a real claim would be mixed-case prose).
        for ph in PHANTOM_PATTERNS:
            ph_lower = ph.lower()
            text_lower = text.lower()
            search_from = 0
            while True:
                idx = text_lower.find(ph_lower, search_from)
                if idx < 0:
                    break
                end = idx + len(ph)
                span = text[idx:end]
                if span.upper() == span and any(c.isalpha() for c in span):
                    search_from = end
                    continue  # all-caps shouting/heading, treat as quote
                if _inside_backticks(text, idx):
                    search_from = end
                    continue  # code-quoted, treat as literal
                # Real paraphrase phantom -- mixed-case prose use.
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
