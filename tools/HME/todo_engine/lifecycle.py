"""Timed auto-flips + set-archival rules for the TODO engine.

Pure functions over (todos, now) so they're testable without a real clock.
Rules from TODO_new.md:

  2_   revisit: after effective_minutes (default 10), flip -> 0_. Also flips
       immediately if every OTHER todo in the set is already complete (5_).
  4f_  follow-up: after effective_minutes (default 30), flip -> 0_, UNLESS a
       qualifier is set (_q="...") -- a qualifier means "wait for the named
       condition", so the timer does not auto-fire.
  archive: a set whose every item is code >= 3 ({3,4,4f,5}) is fully resolved
       for this cycle only if no non-5_ terminal items remain. Non-5_
       terminal items (3_/4_/4f_) stay active in the next set instead of
       being archived again.
"""
from __future__ import annotations

from .grammar import Todo, TIMED_CODES

_COMPLETE = "5"
CARRYOVER_CODES = ("3", "4", "4f")


def _is_complete(todo: Todo) -> bool:
    return todo.code == _COMPLETE


def apply_timers(todos: list[Todo], now: float) -> int:
    """Flip expired 2_/4f_ todos to 0_ in place. Returns count flipped.

    Anchoring: a timed todo without `since` gets it stamped to `now` (timer
    starts when first observed); the flip happens on a later pass once the
    window elapses. Caller persists after stamping so the anchor survives.
    """
    flipped = 0
    others_all_complete = _all_other_complete_map(todos)
    for todo in todos:
        if todo.code not in TIMED_CODES:
            continue
        # 2_ short-circuit: if every other item is complete, revisit now.
        if todo.code == "2" and others_all_complete.get(id(todo), False):
            _flip_to_open(todo)
            flipped += 1
            continue
        # 4f_ with a qualifier waits for the named condition, not the clock.
        if todo.code == "4f" and todo.qualifier:
            continue
        if todo.since is None:
            todo.since = now            # start the clock on first observation
            continue
        minutes = todo.effective_minutes()
        if minutes is None:
            continue
        if (now - todo.since) >= minutes * 60:
            _flip_to_open(todo)
            flipped += 1
    return flipped


def _flip_to_open(todo: Todo) -> None:
    todo.code = "0"
    todo.minutes = None
    todo.qualifier = ""
    todo.since = None


def _all_other_complete_map(todos: list[Todo]) -> dict[int, bool]:
    completes = sum(1 for t in todos if _is_complete(t))
    out: dict[int, bool] = {}
    for t in todos:
        # "every OTHER todo complete" -> all completes are among the others.
        others = completes - (1 if _is_complete(t) else 0)
        total_others = len(todos) - 1
        out[id(t)] = total_others > 0 and others == total_others
    return out


def set_is_archivable(todos: list[Todo]) -> bool:
    """True when the set is non-empty and every item is code >= 3."""
    if not todos:
        return False
    return all(_CODE_RANK.get(t.code, 0) >= _ARCHIVE_MIN_RANK for t in todos)
