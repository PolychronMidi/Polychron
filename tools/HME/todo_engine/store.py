"""Atomic persistence + lifecycle application for the TODO engine.

TODO.md is the single source of truth. Cross-process writers (lifesaver,
pulse, humans, the agent) serialize through an OS flock + atomic rename.
Every load applies due timers and stamps fresh anchors; every save renders
canonical grammar. Archival of a fully-resolved set lands in log/todo/setN.md;
blocked/follow-up non-5_ items stay active and are not re-archived.
"""
from __future__ import annotations

import fcntl
import os
import time
from pathlib import Path

from .grammar import Todo, advance_set_header, parse_document, render_document, set_number
from .lifecycle import CARRYOVER_CODES
from .lifecycle import apply_timers, set_is_archivable


def _root() -> Path:
    return Path(os.environ.get("PROJECT_ROOT") or Path.cwd())  # env-ok: runtime root


def todo_path() -> Path:
    return _root() / "doc" / "templates" / "TODO.md"


def _lock_path() -> Path:
    return todo_path().with_suffix(".md.lock")


def archive_dir() -> Path:
    return _root() / "log" / "todo"


def _read_text() -> str:
    p = todo_path()
    try:
        return p.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def _atomic_write(text: str) -> None:
    p = todo_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f"{p.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, p)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass  # silent-ok: tmp already renamed away


def _next_set_number(header: list[str] | None = None) -> int:
    current = set_number(header or [])
    if current is not None:
        return current
    d = archive_dir()
    if not d.is_dir():
        return 1
    nums = []
    for f in d.glob("set*.md"):
        stem = f.stem[3:]
        if stem.isdigit():
            nums.append(int(stem))
    return (max(nums) + 1) if nums else 1


def _with_lock(fn):
    lock = _lock_path()
    lock.parent.mkdir(parents=True, exist_ok=True)
    with open(lock, "w") as fh:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        except OSError:
            pass  # silent-ok: flock unsupported on some filesystems
        return fn()


def load(now: float | None = None) -> tuple[list[str], list[Todo]]:
    """Load TODO.md, apply due timers, persist if anything changed. Returns
    (header, todos)."""
    now = time.time() if now is None else now

    def _do():
        header, todos = parse_document(_read_text())
        before = [(t.code, t.minutes, t.qualifier, t.since) for t in todos]
        apply_timers(todos, now)
        after = [(t.code, t.minutes, t.qualifier, t.since) for t in todos]
        if before != after:
            _atomic_write(render_document(header, todos))
        return header, todos

    return _with_lock(_do)


def save(header: list[str], todos: list[Todo]) -> None:
    _with_lock(lambda: _atomic_write(render_document(header, todos)))


def mutate(mutator, now: float | None = None):
    """Load (timers applied), run mutator(header, todos) -> any, save, return
    the mutator's value. Single locked critical section."""
    now = time.time() if now is None else now

    def _do():
        header, todos = parse_document(_read_text())
        apply_timers(todos, now)
        result = mutator(header, todos)
        _atomic_write(render_document(header, todos))
        return result

    return _with_lock(_do)


def next_id(todos: list[Todo]) -> int:
    return (max((t.id for t in todos), default=0)) + 1


def maybe_archive(now: float | None = None) -> str | None:
    """If every active item is 5_, archive it to log/todo/set<N>.md and
    advance to an empty next set. Non-5_ items remain active and block archive.
    Returns archive path or None."""
    now = time.time() if now is None else now

    def _do():
        text = _read_text()
        header, todos = parse_document(text)
        if not set_is_archivable(todos):
            return None
        d = archive_dir()
        d.mkdir(parents=True, exist_ok=True)
        n = _next_set_number(header)
        dest = d / f"set{n}.md"
        dest.write_text(render_document(header, todos), encoding="utf-8")
        next_header = advance_set_header(header, n + 1)
        _atomic_write(render_document(next_header, []))
        return str(dest)

    return _with_lock(_do)
