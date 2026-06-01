"""LIFESAVER alert <-> TODO engine bridge.

Runtime errors (worker failures, autocommit, etc.) enter the unified TODO.md
as ordinary status-0 ("created") items so the agent reassesses and re-codes
them like any other todo -- there is no separate "critical" lane. A short
text prefix marks their origin so the turn-start surfacer and recovery path
can find them; dedup keeps a recurring alert from piling up duplicates.

Public API mirrors the names the rest of HME already imports, so the old
todo-store module can re-export these unchanged:
  register_todo_from_lifesaver(source, error, severity) -> None
  list_critical() -> list[dict]      (open lifesaver-origin items, for turn start)
  list_carried_over() -> list[dict]  (all open items)
  resolve_lifesaver_todos(substr) -> int
"""
from __future__ import annotations

import re

from .grammar import Todo
from . import store

# Visible marker so origin survives in plain TODO.md text (no sidecar needed).
LIFESAVER_PREFIX = "LIFESAVER:"
_OPEN_CODES = ("0", "1", "2", "4", "4f")   # not 3 (blocked) or 5 (done)


def _dedup_key(text: str) -> str:
    # Collapse variable tokens (numbers, hex) so structurally identical alerts
    # that differ only by runtime values map to one todo.
    norm = re.sub(r"0x[0-9a-fA-F]+", "#", text)
    norm = re.sub(r"\b\d+(?:\.\d+)?\b", "#", norm)
    return re.sub(r"\s+", " ", norm).strip().lower()[:160]


def _text_for(source: str, error: str) -> str:
    body = re.sub(r"\s+", " ", f"{source}: {error}").strip()
    return f"{LIFESAVER_PREFIX} {body}"[:300]


def register_todo_from_lifesaver(source: str, error: str, severity: str = "CRITICAL") -> None:
    """Append a status-0 todo for a runtime alert, deduped by normalized text."""
    text = _text_for(source, error)
    want = _dedup_key(text)

    def _mut(_header, todos):
        for t in todos:
            # An open lifesaver item with the same normalized text already
            # exists -> no-op. A resolved (5_) one allows a fresh recurrence.
            if (t.text.startswith(LIFESAVER_PREFIX) and t.code != "5"
                    and _dedup_key(t.text) == want):
                return False
        todos.append(Todo(id=store.next_id(todos), code="0", text=text))
        return True

    store.mutate(_mut)


def list_critical() -> list[dict]:
    """Open lifesaver-origin items, surfaced at turn start."""
    _header, todos = store.load()
    return [
        {"id": t.id, "text": t.text, "code": t.code}
        for t in todos
        if t.text.startswith(LIFESAVER_PREFIX) and t.code in _OPEN_CODES
    ]


def list_carried_over() -> list[dict]:
    """All open (not 5_) items from the prior session."""
    _header, todos = store.load()
    return [
        {"id": t.id, "text": t.text, "code": t.code, "lifesaver": t.text.startswith(LIFESAVER_PREFIX)}
        for t in todos
        if t.code != "5"
    ]


def resolve_lifesaver_todos(source_substring: str) -> int:
    """Mark matching open lifesaver items complete (5_). Returns count."""
    if not source_substring:
        return 0
    needle = source_substring.lower()
    count = {"n": 0}

    def _mut(_header, todos):
        changed = False
        for t in todos:
            if (t.text.startswith(LIFESAVER_PREFIX) and t.code != "5"
                    and needle in t.text.lower()):
                t.code = "5"
                count["n"] += 1
                changed = True
        return changed

    store.mutate(_mut)
    return count["n"]
