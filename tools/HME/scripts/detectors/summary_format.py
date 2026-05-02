#!/usr/bin/env python3
"""Stop-the-Line mandatory output format — PAI v6.3.0 import #9.

PAI rule: "Every Algorithm run MUST close with ━━━ 📃 SUMMARY ━━━ 7/7
block. Format violations outrank output length, output quality, and
output detail."

Polychron mapping: tier ≥ E3 (the Algorithm threshold the tier
classifier emits) requires the closing block. Below E3, the format gate
is skipped (light-touch turns shouldn't carry summary boilerplate).

Block schema (case + whitespace tolerant; emoji required):
    ━━━ 📃 SUMMARY ━━━
    🔄 ITERATION: <round/turn marker>
    📃 CONTENT: <one-line content summary>
    🖊️ STORY:
      - problem: <…>
      - what we did: <…>
      - how it went: <…>
      - what's next: <…>
    🗣️ <name>: <8-16 word closing line>

Verdicts:
  ok                     tier < E3 OR block present and well-formed
  summary_missing        tier ≥ E3 AND no closing block detected
  summary_malformed      tier ≥ E3 AND block present but missing fields

The detector reads tier from output/metrics/mode-classifier.jsonl
(latest line) or the SUMMARY_FORMAT_TIER env override (used by tests).

Usage: summary_format.py <transcript_path>
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transcript import load_turn_events, event_content  # noqa: E402

_HERE = Path(__file__).resolve().parent
_PROJECT = Path(os.environ.get("PROJECT_ROOT") or _HERE.parent.parent.parent.parent)
_MODE_LOG = _PROJECT / "output" / "metrics" / "mode-classifier.jsonl"

# Trigger tiers — E3+ is the Algorithm floor where the format is required.
_TRIGGER_TIERS = {"E3", "E4", "E5"}

_BANNER_RE = re.compile(r"━━━\s*📃\s*SUMMARY\s*━━━")
_ITER_RE   = re.compile(r"🔄\s*ITERATION\s*:", re.IGNORECASE)
_CONTENT_RE = re.compile(r"📃\s*CONTENT\s*:", re.IGNORECASE)
_STORY_RE  = re.compile(r"🖊️\s*STORY\s*:", re.IGNORECASE)
_VOICE_RE  = re.compile(r"🗣️\s*[^\n:]{1,40}\s*:")

_STORY_BULLETS = (
    re.compile(r"^\s*[-*•]\s*problem\s*:", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*[-*•]\s*what\s+we\s+did\s*:", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*[-*•]\s*how\s+it\s+went\s*:", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*[-*•]\s*what['’]?s?\s+next\s*:", re.IGNORECASE | re.MULTILINE),
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


def _read_tier() -> str | None:
    if os.environ.get("SUMMARY_FORMAT_TIER"):
        return os.environ["SUMMARY_FORMAT_TIER"]
    if not _MODE_LOG.is_file():
        return None
    try:
        last = None
        with open(_MODE_LOG, encoding="utf-8") as f:
            for line in f:
                try:
                    last = json.loads(line)
                except json.JSONDecodeError:
                    continue
        return last.get("tier") if last else None
    except OSError:
        return None


def _validate_block(text: str) -> str:
    """Return 'ok', 'missing', or 'malformed'."""
    if not _BANNER_RE.search(text):
        return "missing"
    fields_present = (
        bool(_ITER_RE.search(text)),
        bool(_CONTENT_RE.search(text)),
        bool(_STORY_RE.search(text)),
        bool(_VOICE_RE.search(text)),
        all(pat.search(text) for pat in _STORY_BULLETS),
    )
    if all(fields_present):
        return "ok"
    return "malformed"


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0

    tier = _read_tier()
    if tier not in _TRIGGER_TIERS:
        print("ok")
        return 0

    events = load_turn_events(sys.argv[1])
    text = _last_assistant_text(events)
    if not text:
        print("ok")
        return 0

    verdict = _validate_block(text)
    if verdict == "ok":
        print("ok")
    elif verdict == "missing":
        print("summary_missing")
    else:
        print("summary_malformed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
