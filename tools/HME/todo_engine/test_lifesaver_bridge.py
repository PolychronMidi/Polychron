"""Tests for the LIFESAVER<->engine bridge over a temp PROJECT_ROOT."""
import os
import sys
import tempfile
from pathlib import Path


def _fresh():
    d = tempfile.mkdtemp(prefix="todo-bridge-test-")
    os.environ["PROJECT_ROOT"] = d
    (Path(d) / "doc" / "templates").mkdir(parents=True, exist_ok=True)
    (Path(d) / "doc" / "templates" / "TODO.md").write_text("# rules\n\n", encoding="utf-8")
    for m in ("todo_engine.store", "todo_engine.lifecycle", "todo_engine.grammar",
              "todo_engine.lifesaver_bridge"):
        sys.modules.pop(m, None)
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import todo_engine.lifesaver_bridge as b
    return d, b


def test_alert_becomes_status0_todo():
    d, b = _fresh()
    b.register_todo_from_lifesaver("worker", "connection refused", "CRITICAL")
    crit = b.list_critical()
    assert len(crit) == 1
    assert crit[0]["code"] == "0"
    assert crit[0]["text"].startswith("LIFESAVER:")
    assert "connection refused" in crit[0]["text"]


def test_recurring_alert_dedups():
    d, b = _fresh()
    b.register_todo_from_lifesaver("gpu", "only 17342 MB free", "CRITICAL")
    b.register_todo_from_lifesaver("gpu", "only 16826 MB free", "CRITICAL")  # differs only by number
    assert len(b.list_critical()) == 1   # collapsed to one


def test_agent_recode_drops_from_critical_but_stays_in_carried_over():
    d, b = _fresh()
    b.register_todo_from_lifesaver("x", "boom", "CRITICAL")
    # agent reassesses -> marks it a block (3_) by editing TODO.md via the store
    from todo_engine import store
    def _block(_h, todos):
        todos[0].code = "3"
        return True
    store.mutate(_block)
    assert b.list_critical() == []                 # 3_ is not an open "needs-triage" code
    assert len(b.list_carried_over()) == 1         # still an open item overall


def test_resolve_marks_done():
    d, b = _fresh()
    b.register_todo_from_lifesaver("rag", "shim refused", "CRITICAL")
    n = b.resolve_lifesaver_todos("shim")
    assert n == 1
    assert b.list_critical() == []
    # resolved item allows a fresh recurrence later
    b.register_todo_from_lifesaver("rag", "shim refused", "CRITICAL")
    assert len(b.list_critical()) == 1


if __name__ == "__main__":
    n = 0
    for name, fn in sorted(dict(globals()).items()):
        if name.startswith("test_") and callable(fn):
            fn(); n += 1; print(f"  ok {name}")
    print(f"{n} tests passed")
