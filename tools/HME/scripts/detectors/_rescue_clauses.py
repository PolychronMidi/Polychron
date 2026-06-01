"""Shared rescue-clause regexes for the deferral-detector family.

scope_escape, exhaust_check, and psycho_stop each fire on a
fix-not-done shape. The deny prompts they're paired with all sanction
TWO valid responses:
  (a) fix it, or
  (b) explain why fixing is the wrong move.

(a) was already covered (per-detector RESCUE_RES variants). (b) was
not -- every legitimate refusal-with-reason got pattern-matched as a
punt, which trained agents to stop refusing even when refusing was
correct. This module gives all three detectors a uniform recognizer
for (b) so the path the deny advertises actually exists.

Recognition shape: any sentence-length window (240-320 chars in either
direction from the trigger) that contains an explicit refusal-with-
reason: "not doing this is the right call", "fixing this would break",
"duplicates the existing X", "already covered by Y", explicit "(b)-
clause:" / "(b)" labels, "shouldn't do this because", etc.

Conservative: the patterns require the agent to NAME the alternative
or the consequence. A bare "won't do it" without justification doesn't
qualify -- that's the punt the detectors are supposed to catch.
"""
from __future__ import annotations

import re

# (b)-clause rescue patterns. Bidirectional scan: justifications can
B_CLAUSE_RES = (
    # explicit "not doing X is the right (call|move|thing|choice)"
    re.compile(
        r"\b(not\s+doing\s+(this|that|it|these)|skipping\s+(this|that|it))\s+"
        r"is\s+(the\s+)?(right|correct|better)\s+"
        r"(call|move|thing|choice|approach|decision)\b",
        re.IGNORECASE,
    ),
    # "the right (call|move|thing) is to (skip|not fix|leave it|punt)"
    re.compile(
        r"\bthe\s+(right|correct)\s+(call|move|thing|choice)\s+is\s+to\s+"
        r"(skip|not\s+(fix|do)|leave|punt)\b",
        re.IGNORECASE,
    ),
    # "fixing (this|X) (would|will) (break|cause|require|introduce|conflict|regress)"
    re.compile(
        r"\bfixing\s+(this|it|that|them)\s+(would|will|might)\s+"
        r"(break|cause|require|introduce|conflict|regress)\b",
        re.IGNORECASE,
    ),
    # "duplicates X" / "redundant with X" / "already provides X"
    re.compile(
        r"\b(duplicates?|redundant\s+with|already\s+provides?)\s+\w+",
        re.IGNORECASE,
    ),
    # "buys nothing X doesn't already (buy|provide|catch|cover)"
    re.compile(
        r"\bbuys?\s+(nothing|no\s+\w+)\s+(the|that)\s+\S+\s+\S*\s*"
        r"(doesn'?t|does\s+not)\s+(already\s+)?"
        r"(buy|provide|catch|cover)\b",
        re.IGNORECASE,
    ),
    # "already (covered|caught|handled|guaranteed) by"
    re.compile(
        r"\balready\s+(covered|caught|handled|addressed|guaranteed)\s+by\b",
        re.IGNORECASE,
    ),
    # explicit "(b)-clause" / "(b)" label
    re.compile(r"\(b\)[\s-]*clause\b", re.IGNORECASE),
    re.compile(
        r"\bwould\s+(be|require)\s+(an?\s+)?"
        r"(unrelated|out-of-scope|breaking|destructive|risky|unsafe)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(shouldn'?t|should\s+not|won'?t)\s+"
        r"(do|fix|touch|change|modify|implement)\s+(this|that|it)\b"
        r"[^.\n]{0,40}\b(because|since|as|--)",
        re.IGNORECASE,
    ),
)


def b_clause_within_window(text: str, anchor: int, window: int = 320) -> bool:
    """Bidirectional (b)-clause scan around `anchor`. Returns True if any
    of the recognizer regexes matches within `window` chars before or
    after the anchor position. The wider-than-fix-claim window reflects
    that justifications run sentence-length, often spanning multiple
    clauses before naming the alternative."""
    fwd_end = min(len(text), anchor + window)
    back_begin = max(0, anchor - window)
    chunk = text[back_begin:fwd_end]
    for pat in B_CLAUSE_RES:
        if pat.search(chunk):
            return True
    return False
