"""Shared transcript-parsing helpers for stop.sh detectors.

All detectors share the same basic shape: read a JSONL transcript, walk the
current turn (last user message backwards to prior user message), inspect
tool_use / tool_result blocks. This module provides parsers so the
individual detectors stay small and each can be unit-tested in isolation.

Usage:
    from _transcript import load_turn_events, iter_tool_uses, iter_tool_results

    for obj in load_turn_events(transcript_path):
        for tu in iter_tool_uses(obj):
            if tu["name"] == "Bash":
                ...

Design contract: detectors NEVER raise. They print a status token to stdout
and exit 0. stop.sh captures the token and dispatches. A missing / unreadable
/ corrupt transcript should produce "ok" (the stop-friendly default) so that
detector bugs can never block the user.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Iterator


# Per-process cache of parsed transcripts. run_all.py (the consolidated
# detector runner) reads a multi-MB transcript once; every downstream
# detector's load_turn_events() call returns the cached parse instead of
# re-reading + re-JSON-parsing the same file. Matters for stop-hook p95.
_PARSE_CACHE: dict[str, list[dict]] = {}


def is_assistant(event: dict) -> bool:
    """Works against both real Claude Code transcripts and test fixtures.

    Real shape       : {"type":"assistant", "message":{"role":"assistant",...}}
    Test-fixture shape: {"role":"assistant", "content":[...]}

    Historical bug: detectors checked only the fixture shape (`role="assistant"`
    at top level). Every real event has `role=None` at top level and
    `type="assistant"` instead, so the check returned False on 100% of real
    events — silently disabling exhaust_check / early_stop / fabrication_check
    / anyone else that used the same test. Caught April 2026.
    """
    if event.get("type") == "assistant":
        return True
    return event.get("role") == "assistant" and bool(event.get("content"))


def is_user(event: dict) -> bool:
    """Same dual-shape tolerance for user events."""
    if event.get("type") == "user":
        return True
    return event.get("role") == "user"


def event_content(event: dict) -> list:
    """Return the content blocks for an event, regardless of shape."""
    msg = event.get("message")
    if isinstance(msg, dict):
        maybe = msg.get("content")
        if isinstance(maybe, list):
            return maybe
    maybe = event.get("content")
    if isinstance(maybe, list):
        return maybe
    return []


def _parse_all(transcript_path: str | Path) -> list[dict]:
    key = str(transcript_path)
    if key in _PARSE_CACHE:
        return _PARSE_CACHE[key]
    try:
        data = Path(transcript_path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        _PARSE_CACHE[key] = []
        return []
    events: list[dict] = []
    for line in data.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    _PARSE_CACHE[key] = events
    return events


def load_turn_events(transcript_path: str | Path) -> list[dict]:
    """Return the list of events in the current turn, oldest first.

    A "turn" starts at the most recent user message (inclusive, as the
    boundary) and ends at the most recent assistant message. Events outside
    that window are excluded.

    Returns [] on any read/parse failure — callers then short-circuit to
    the safe "ok" status.
    """
    events = _parse_all(transcript_path)
    # Find the last user message; turn is everything after it.
    last_user_idx = -1
    for i, obj in enumerate(events):
        if is_user(obj):
            last_user_idx = i
    if last_user_idx == -1:
        return events
    return events[last_user_idx + 1:]


def load_full_turn_with_user(transcript_path: str | Path) -> list[dict]:
    """Like load_turn_events but includes the triggering user message at index 0.

    Needed by detectors that want to inspect tool_result blocks in the
    same iteration order as they appear to the model (user turn -> assistant
    tool calls -> tool results).
    """
    events = _parse_all(transcript_path)
    last_user_idx = -1
    for i, obj in enumerate(events):
        if is_user(obj):
            last_user_idx = i
    if last_user_idx == -1:
        return events
    return events[last_user_idx:]


def iter_tool_uses(event: dict) -> Iterator[dict]:
    """Yield each tool_use content block inside an event, with fields
    ``name`` / ``input`` / ``id`` filled in (missing fields default empty)."""
    for block in event_content(event):
        if not isinstance(block, dict):
            continue
        if block.get("type") != "tool_use":
            continue
        yield {
            "name": block.get("name", ""),
            "input": block.get("input", {}) or {},
            "id": block.get("id", ""),
        }


def iter_tool_results(event: dict) -> Iterator[dict]:
    """Yield each tool_result content block with a ``text`` field that
    concatenates any text payloads (so callers can grep over it)."""
    for block in event_content(event):
        if not isinstance(block, dict):
            continue
        if block.get("type") != "tool_result":
            continue
        parts = block.get("content", [])
        text = ""
        if isinstance(parts, list):
            for p in parts:
                if isinstance(p, dict) and p.get("type") == "text":
                    text += p.get("text", "")
                elif isinstance(p, str):
                    text += p
        elif isinstance(parts, str):
            text = parts
        yield {
            "tool_use_id": block.get("tool_use_id", ""),
            "text": text,
        }


def last_assistant_event(transcript_path: str | Path) -> dict | None:
    """Return the most recent assistant event, or None.

    Used by stop-work detection which only needs the very last assistant
    message's shape.

    Prior implementation contained a promise-vs-delivers bug: it early-
    returned on the first user-after-assistant, which meant given a
    transcript of [user1, asst1, user2, asst2], it returned asst1
    instead of asst2 — the OLDEST completed assistant, not the most
    recent. stop_work.py consumes this and was evaluating the previous
    turn's message in any session where the transcript contains more
    than one completed turn. Fixed to walk the full event stream and
    track the latest assistant. Peer-review iter 110.
    """
    try:
        data = Path(transcript_path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None
    last_assistant: dict | None = None
    for line in data.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if is_assistant(obj):
            last_assistant = obj
    return last_assistant
