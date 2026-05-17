#!/usr/bin/env python3
"""SatisfactionCapture -- PAI v6.3.0 import #8.

Rate every non-system prompt 1-10. The user's NEW prompt scores their
satisfaction with the PRIOR turn (the previous assistant response). Wire
this to the UserPromptSubmit lifecycle: when a new prompt arrives, score
it as the rating for the just-completed turn.

Critical PAI fix imported verbatim: "Previous system returned null for
neutral prompts, meaning no rating was recorded. Now EVERY non-system
prompt gets a rating. Neutral = 5, not null." We never emit null.

Heuristics, in priority order:
  1. Explicit bare integer 1-10 ("8", "rate: 7", "score 9")
  2. Strong-positive markers ("perfect", "excellent", "amazing") -> 9
  3. Mild-positive markers ("great", "good", "thanks") -> 7-8
  4. Correction openers ("actually", "wait", "no,") -> 4
  5. Strong-negative markers ("wrong", "broken", "terrible") -> 2
  6. Neutral / unmatched -> 5

Output: append one JSONL line per scored prompt to
src/output/metrics/satisfaction.jsonl. Schema:
  {ts, turn_index, score, signal_type, prompt_excerpt}

Usage:
  satisfaction_capture.py <prompt-text>     # score and append
  satisfaction_capture.py --print <text>    # print score only (no append)
  cat | satisfaction_capture.py             # stdin form

Hooks integration: userpromptsubmit.sh pipes the new prompt in via
stdin so the score reflects user feedback on the JUST-FINISHED turn.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_PROJECT = Path(os.environ.get("PROJECT_ROOT") or _HERE.parent.parent.parent)
_METRICS_DIR = Path(os.environ.get("HME_METRICS_DIR") or (_PROJECT / "tools" / "HME" / "runtime" / "metrics"))
_OUT_FILE = _METRICS_DIR / "satisfaction.jsonl"

# Heuristic markers. Order: explicit number first, then strong signals,
_NUMERIC_RE = re.compile(
    r"\b(?:rate|rating|score)\s*[:=]?\s*(\d{1,2})\b|"
    r"^\s*(\d{1,2})\s*/\s*10\s*$|"
    r"^\s*(\d{1,2})[.\s!]*$",
    re.IGNORECASE | re.MULTILINE,
)

_STRONG_POS = (
    "perfect", "excellent", "amazing", "exactly right", "exactly what",
    "love it", "incredible", "brilliant", "outstanding",
)
_MILD_POS = (
    "great", "good job", "good work", "thanks", "thank you", "nice",
    "ok great", "lgtm", "looks good", "ship it", "well done",
)
_CORRECTION_OPENERS = (
    "actually", "wait,", "wait --", "no,", "no --", "instead",
    "hmm,", "not quite", "almost", "close, but",
)
_STRONG_NEG = (
    "wrong", "broken", "terrible", "useless", "garbage", "awful",
    "this is bad", "what the", "wtf", "psychopath", "stop doing",
    "you missed", "you ignored", "completely wrong",
)


def _utc_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _score_prompt(text: str) -> tuple[int, str]:
    """Score a prompt 1-10 with the matched signal bucket label.

    Never returns None. Unmatched prompts score 5 (neutral) per the PAI
    fix -- null was the bug we're explicitly importing the patch for."""
    if not text:
        return 5, "empty"
    head = text[:600]  # only head matters; long prompts dilute signal

    m = _NUMERIC_RE.search(head)
    if m:
        for group in m.groups():
            if group is not None:
                try:
                    n = int(group)
                except ValueError:
                    continue
                if 1 <= n <= 10:
                    return n, "explicit_numeric"

    low = head.lower()

    for marker in _STRONG_POS:
        if marker in low:
            return 9, f"strong_pos:{marker}"
    for marker in _MILD_POS:
        if marker in low:
            return 7, f"mild_pos:{marker}"
    for marker in _STRONG_NEG:
        if marker in low:
            return 2, f"strong_neg:{marker}"
    for marker in _CORRECTION_OPENERS:
        # Anchor to the prompt's HEAD so an in-sentence "actually" doesn't
        if low.startswith(marker) or low[:80].find(marker) >= 0:
            return 4, f"correction:{marker}"

    return 5, "neutral"


def _next_turn_index() -> int:
    """Walk satisfaction.jsonl tail and increment. Cheaper than parsing
    the entire transcript. Returns 1 on first call."""
    if not _OUT_FILE.is_file():
        return 1
    last = 0
    try:
        with open(_OUT_FILE, encoding="utf-8") as f:
            for line in f:
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                idx = e.get("turn_index")
                if isinstance(idx, int) and idx > last:
                    last = idx
    except OSError:
        return 1
    return last + 1


def _append(score: int, signal: str, excerpt: str) -> None:
    _OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "ts": _utc_now(),
        "turn_index": _next_turn_index(),
        "score": score,
        "signal_type": signal,
        "prompt_excerpt": excerpt[:160],
    }
    with open(_OUT_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def main(argv: list) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("prompt", nargs="?",
                   help="prompt text; reads stdin if omitted")
    p.add_argument("--print", action="store_true",
                   help="print score only, do not append to JSONL")
    args = p.parse_args(argv)

    if args.prompt is not None:
        text = args.prompt
    else:
        text = sys.stdin.read() if not sys.stdin.isatty() else ""
    text = text.strip()

    score, signal = _score_prompt(text)

    if args.print:
        print(f"{score}\t{signal}")
        return 0

    if not text:
        # Empty input still records a neutral score so the per-turn
        # ledger never gains a null gap. PAI's exact rule.
        _append(5, "empty", "")
        return 0

    _append(score, signal, text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
