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

import hashlib
import json
import os
from pathlib import Path
from typing import Iterable, Iterator


# Per-process cache of parsed transcripts. run_all.py (the consolidated
_PARSE_CACHE: dict[str, list[dict]] = {}

# Cross-process disk cache. Bulletproofed against append/rewrite/truncation/
# concurrent-writer scenarios via prefix-fingerprint verification.
_DISK_CACHE_DIR_ENV = "HME_TRANSCRIPT_CACHE_DIR"
_DISK_CACHE_SAMPLE_BYTES = 512
_DISK_CACHE_MAX_BYTES = int(os.environ.get("HME_TRANSCRIPT_CACHE_MAX_BYTES") or 10 * 1024 * 1024)


def _disk_cache_dir() -> Path:
    override = os.environ.get(_DISK_CACHE_DIR_ENV)
    if override:
        return Path(override)
    root = os.environ.get("PROJECT_ROOT")
    base = Path(root) if root else Path(__file__).resolve().parents[4]
    return base / "tools" / "HME" / "runtime" / "transcript-cache"


def _disk_cache_path(transcript_path: str) -> Path:
    key = hashlib.sha256(os.path.abspath(transcript_path).encode("utf-8", "replace")).hexdigest()[:16]
    return _disk_cache_dir() / f"{key}.json"


def _fingerprint_prefix(fd, prefix_size: int) -> str:
    h = hashlib.blake2b(digest_size=16)
    h.update(prefix_size.to_bytes(8, "little"))
    if prefix_size <= 0:
        return h.hexdigest()
    sample = min(_DISK_CACHE_SAMPLE_BYTES, prefix_size)
    offsets = [0]
    if prefix_size > sample * 2:
        offsets.append(prefix_size // 2 - sample // 2)
    if prefix_size > sample:
        offsets.append(prefix_size - sample)
    for offset in offsets:
        try:
            fd.seek(offset)
            h.update(fd.read(min(sample, prefix_size - offset)))
        except (OSError, ValueError):
            return ""
    return h.hexdigest()


def _load_disk_cache(cache_path: Path) -> dict | None:
    try:
        obj = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if (not isinstance(obj, dict)
        or not isinstance(obj.get("size"), int)
        or not isinstance(obj.get("fingerprint"), str)
        or not isinstance(obj.get("events"), list)):
        return None
    return obj


_DISK_CACHE_TTL_SEC = 86400 * 3


def _save_disk_cache(cache_path: Path, size: int, fingerprint: str, events: list[dict]) -> None:
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = cache_path.with_suffix(cache_path.suffix + f".{os.getpid()}.tmp")
        tmp.write_text(
            json.dumps({"size": size, "fingerprint": fingerprint, "events": events}, separators=(",", ":")),
            encoding="utf-8",
        )
        os.replace(tmp, cache_path)
        _lazy_cleanup(cache_path.parent)
    except OSError:
        pass  # silent-ok: cache is a perf optimization; correctness handled by re-parse fallback


def _lazy_cleanup(cache_dir: Path) -> None:
    if (os.getpid() & 0x3F) != 0:
        return
    try:
        import time as _t
        now = _t.time()
        for entry in cache_dir.iterdir():
            try:
                if now - entry.stat().st_mtime > _DISK_CACHE_TTL_SEC:
                    entry.unlink()
            except OSError:
                continue
    except OSError:
        pass  # silent-ok: cleanup is best-effort


def _parse_jsonl_bytes(data: bytes) -> list[dict]:
    out: list[dict] = []
    for line in data.decode("utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _read_with_disk_cache(transcript_path: str) -> list[dict]:
    try:
        st = os.stat(transcript_path)
    except OSError:
        return []
    if st.st_size == 0:
        return []
    if st.st_size > _DISK_CACHE_MAX_BYTES:
        try:
            with open(transcript_path, "rb") as fd:
                return _parse_jsonl_bytes(fd.read(st.st_size))
        except OSError:
            return []
    cache_path = _disk_cache_path(transcript_path)
    cached = _load_disk_cache(cache_path)
    try:
        with open(transcript_path, "rb") as fd:
            if cached and 0 < cached["size"] <= st.st_size:
                fp_at_cached = _fingerprint_prefix(fd, cached["size"])
                if fp_at_cached and fp_at_cached == cached["fingerprint"]:
                    if cached["size"] == st.st_size:
                        return cached["events"]
                    fd.seek(cached["size"])
                    tail_events = _parse_jsonl_bytes(fd.read(st.st_size - cached["size"]))
                    events = list(cached["events"]) + tail_events
                    new_fp = _fingerprint_prefix(fd, st.st_size)
                    _save_disk_cache(cache_path, st.st_size, new_fp, events)
                    return events
            fd.seek(0)
            events = _parse_jsonl_bytes(fd.read(st.st_size))
            fp = _fingerprint_prefix(fd, st.st_size)
            _save_disk_cache(cache_path, st.st_size, fp, events)
            return events
    except OSError:
        return []


def is_assistant(event: dict) -> bool:
    """Works against both real Claude Code transcripts and test fixtures.

    Real shape       : {"type":"assistant", "message":{"role":"assistant",...}}
    Test-fixture shape: {"role":"assistant", "content":[...]}

    Historical bug: detectors checked only the fixture shape (`role="assistant"`
    at top level). Every real event has `role=None` at top level and
    `type="assistant"` instead, so the check returned False on 100% of real
    events -- silently disabling exhaust_check / early_stop / fabrication_check
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
    events = _read_with_disk_cache(key)
    _PARSE_CACHE[key] = events
    return events


def is_real_user_prompt(event: dict) -> bool:
    """True for human prompts; false for tool_result user wrappers."""
    if not is_user(event):
        return False
    content = event.get("message", {}).get("content") if isinstance(event.get("message"), dict) else event.get("content")
    if isinstance(content, str):
        return bool(content.strip())
    if not isinstance(content, list):
        return False
    has_text = any(isinstance(b, dict) and b.get("type") == "text" for b in content)
    has_tool_result = any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content)
    return has_text and not has_tool_result


def _last_real_user_idx(events: list[dict]) -> int:
    last_user_idx = -1
    for i, obj in enumerate(events):
        if is_real_user_prompt(obj):
            last_user_idx = i
    return last_user_idx


def load_turn_events(transcript_path: str | Path) -> list[dict]:
    """Events in the current turn, oldest first. Boundary = most recent
    REAL user prompt, NOT tool_result wrappers."""
    events = _parse_all(transcript_path)
    last_user_idx = _last_real_user_idx(events)
    if last_user_idx == -1:
        return events
    return events[last_user_idx + 1:]


def load_full_turn_with_user(transcript_path: str | Path) -> list[dict]:
    """Like load_turn_events but includes the triggering user message."""
    events = _parse_all(transcript_path)
    last_user_idx = _last_real_user_idx(events)
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
    instead of asst2 -- the OLDEST completed assistant, not the most
    recent. stop_work.py consumes this and was evaluating the previous
    turn's message in any session where the transcript contains more
    than one completed turn. Fixed to walk the full event stream and
    track the latest assistant. Peer-review iter 110.
    """
    try:
        data = Path(transcript_path).read_text(encoding="utf-8", errors="ignore")
    except OSError as e:
        import sys as _sys
        _sys.stderr.write(
            f"[_transcript.last_assistant] read failed for {transcript_path!r}: "
            f"{type(e).__name__}: {e} -- proceeding without last-assistant\n"
        )
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
