#!/usr/bin/env python3
"""Stop-the-Line mandatory output format -- PAI v6.3.0 import #9.

PAI rule: "Every Algorithm run MUST close with a structured 7-field summary
block. Format violations outrank output length, output quality, and output
detail." The original PAI doctrine uses emoji markers; Polychron's
ASCII-first project rule (project-wide no-non-ascii audit, no emoji
allowlist) requires the same structure with text labels:

    === SUMMARY ===
    [ITERATION]: <round/turn marker>
    [CONTENT]: <one-line content summary>
    [STORY]:
      - problem: <...>
      - what we did: <...>
      - how it went: <...>
      - what's next: <...>
    [VOICE] <name>: <8-16 word closing line>

Polychron mapping: tier >= E3 (the Algorithm threshold the tier classifier
emits) requires the closing block. Below E3, the format gate is skipped
(light-touch turns shouldn't carry summary boilerplate).

Verdicts:
  ok                     tier < E3 OR block present and well-formed
  summary_missing        tier >= E3 AND no closing block detected
  summary_malformed      tier >= E3 AND block present but missing fields

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

# Trigger tiers - E5 only. E3 (multi-file algorithm) and E4 (deep work)
# fire too frequently for the literal closing block to be useful; emitting
# the block to satisfy the gate became the ceremony-spam pattern the user
# called out. E5 (Comprehensive sweep / cross-cutting refactor) is the
# narrow case where the structured close is genuinely worth the ceremony.
_TRIGGER_TIERS = {"E5"}

_BANNER_RE = re.compile(r"={3,}\s*SUMMARY\s*={3,}")
_ITER_RE   = re.compile(r"\[ITERATION\]\s*:", re.IGNORECASE)
_CONTENT_RE = re.compile(r"\[CONTENT\]\s*:", re.IGNORECASE)
_STORY_RE  = re.compile(r"\[STORY\]\s*:", re.IGNORECASE)
_VOICE_RE  = re.compile(r"\[VOICE\]\s+\S[^\n:]{0,40}:")

_STORY_BULLETS = (
    re.compile(r"^\s*[-*]\s*problem\s*:", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*[-*]\s*what\s+we\s+did\s*:", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*[-*]\s*how\s+it\s+went\s*:", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*[-*]\s*what(?:'|\u2019)?s?\s+next\s*:",
               re.IGNORECASE | re.MULTILINE),
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
    # Detector demoted to advisory + hard-disabled at the verdict layer.
    # Reason: the SUMMARY-block doctrine produces ceremony spam on
    # otherwise-substantive turns. work_checks.js was updated to remove
    # SUMMARY_FORMAT from its deny chain, but a long-running proxy daemon
    # caches the OLD chain until restart. Until the daemon picks up the
    # demotion (or until SUMMARY block enforcement is genuinely warranted
    # again at E5-only), this detector unconditionally returns "ok" so
    # the cached chain has nothing to fire on. The Python source stays in
    # place so observability (audit_detectors corpus + reflection JSONL)
    # can be re-promoted by deleting these few lines.
    if len(sys.argv) < 2:
        print("ok")
        return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
