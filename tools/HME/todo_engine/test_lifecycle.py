"""Tests for todo_engine.lifecycle timed flips + archival. Injected clock."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from todo_engine.grammar import Todo  # noqa: E402
from todo_engine.lifecycle import apply_timers, set_is_archivable  # noqa: E402

T0 = 1_000_000.0


def test_first_observation_stamps_since_no_flip():
    todos = [Todo(id=1, code="2", text="revisit")]
    assert apply_timers(todos, T0) == 0
    assert todos[0].since == T0 and todos[0].code == "2"


def test_revisit_flips_after_default_10min():
    todos = [Todo(id=1, code="2", text="r", since=T0), Todo(id=2, code="1", text="busy")]
    assert apply_timers(todos, T0 + 9 * 60) == 0          # not yet
    assert apply_timers(todos, T0 + 10 * 60) == 1         # at window
    assert todos[0].code == "0" and todos[0].since is None


def test_revisit_custom_minutes():
    todos = [Todo(id=1, code="2", text="r", minutes=60, since=T0), Todo(id=2, code="1", text="x")]
    assert apply_timers(todos, T0 + 59 * 60) == 0
    assert apply_timers(todos, T0 + 60 * 60) == 1


def test_revisit_short_circuits_when_others_complete():
    todos = [Todo(id=1, code="2", text="r", since=T0), Todo(id=2, code="5", text="done")]
    # all OTHER items complete -> revisit immediately regardless of clock
    assert apply_timers(todos, T0 + 1) == 1
    assert todos[0].code == "0"


def test_followup_flips_after_30min():
    todos = [Todo(id=1, code="4f", text="f", since=T0)]
    assert apply_timers(todos, T0 + 29 * 60) == 0
    assert apply_timers(todos, T0 + 30 * 60) == 1
    assert todos[0].code == "0"


def test_followup_with_qualifier_never_auto_flips():
    todos = [Todo(id=1, code="4f", text="f", qualifier="after review", since=T0)]
    assert apply_timers(todos, T0 + 999 * 60) == 0
    assert todos[0].code == "4f"


def test_archivable_requires_all_done():
    assert not set_is_archivable([])
    assert not set_is_archivable([Todo(1, "5", "a"), Todo(2, "1", "b")])
    assert not set_is_archivable([Todo(1, "3", "a"), Todo(2, "5", "b"), Todo(3, "4f", "c")])
    assert set_is_archivable([Todo(1, "5", "a"), Todo(2, "5", "b")])
    assert not set_is_archivable([Todo(1, "2", "a"), Todo(2, "5", "b")])


if __name__ == "__main__":
    n = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            n += 1
            print(f"  ok {name}")
    print(f"{n} tests passed")
