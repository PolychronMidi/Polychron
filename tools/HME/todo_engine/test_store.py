"""Store tests over a temp PROJECT_ROOT. No real clock, no real repo touched."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

T0 = 2_000_000.0


def _fresh_root():
    d = tempfile.mkdtemp(prefix="todo-engine-test-")
    os.environ["PROJECT_ROOT"] = d
    (Path(d) / "doc" / "templates").mkdir(parents=True, exist_ok=True)
    # reimport store so _root() picks up the new env each test
    for m in ("todo_engine.store", "todo_engine.lifecycle", "todo_engine.grammar"):
        sys.modules.pop(m, None)
    import todo_engine.store as store  # noqa: E402
    return d, store


def _write(d, body):
    (Path(d) / "doc" / "templates" / "TODO.md").write_text(body, encoding="utf-8")


def test_load_applies_and_persists_timer_flip():
    d, store = _fresh_root()
    _write(d, "# rules\n\n#1 4f_ follow <!-- since:1 -->\n")
    header, todos = store.load(now=T0)              # since=1, way past 30min
    assert todos[0].code == "0"
    # persisted: reloading shows the flip stuck
    _, todos2 = store.load(now=T0)
    assert todos2[0].code == "0"


def test_load_stamps_since_on_first_view():
    d, store = _fresh_root()
    _write(d, "# rules\n\n#1 2_ revisit\n")
    _, todos = store.load(now=T0)
    assert todos[0].since == T0 and todos[0].code == "2"


def test_mutate_roundtrips():
    d, store = _fresh_root()
    _write(d, "# rules\n\n#1 0_ task one\n")

    def add(header, todos):
        from todo_engine.grammar import Todo
        todos.append(Todo(id=2, code="1", text="task two"))
        return len(todos)

    n = store.mutate(add, now=T0)
    assert n == 2
    _, todos = store.load(now=T0)
    assert [t.id for t in todos] == [1, 2] and todos[1].code == "1"


def test_archive_when_all_resolved_carries_non_done_todos():
    d, store = _fresh_root()
    _write(d, "# rules\n\n### Todo - Set 4\n\n#1 5_ done a\n#2 3_ blocked b\n#3 4f_ follow c\n")
    path = store.maybe_archive(now=T0)
    assert path is not None and Path(path).name == "set4.md"
    # archive captured the immutable old set
    archived = Path(path).read_text()
    assert "done a" in archived and "blocked b" in archived and "follow c" in archived
    # TODO.md advanced and carried only non-5_ terminal items.
    todo_text = (Path(d) / "doc" / "templates" / "TODO.md").read_text(encoding="utf-8")
    assert "### Todo - Set 5" in todo_text
    _, todos = store.load(now=T0)
    assert [(t.id, t.code, t.text) for t in todos] == [(2, "3", "blocked b"), (3, "4f", "follow c")]
    assert "done a" not in todo_text
    # next archive honors the active header, not max(log/todo)+1.
    _write(d, "# rules\n\n### Todo - Set 8\n\n#3 5_ done c\n")
    path2 = store.maybe_archive(now=T0)
    assert Path(path2).name == "set8.md"


def test_archive_without_header_falls_back_to_next_log_number():
    d, store = _fresh_root()
    (Path(d) / "log" / "todo").mkdir(parents=True, exist_ok=True)
    (Path(d) / "log" / "todo" / "set2.md").write_text("old", encoding="utf-8")
    _write(d, "# rules\n\n#1 5_ done a\n#2 3_ blocked b\n")
    path = store.maybe_archive(now=T0)
    assert path is not None and Path(path).name == "set3.md"


def test_no_archive_when_open_items():
    d, store = _fresh_root()
    _write(d, "# rules\n\n#1 5_ done\n#2 1_ still working\n")
    assert store.maybe_archive(now=T0) is None
    _, todos = store.load(now=T0)
    assert len(todos) == 2


if __name__ == "__main__":
    n = 0
    g = dict(globals())
    for name, fn in sorted(g.items()):
        if name.startswith("test_") and callable(fn):
            fn()
            n += 1
            print(f"  ok {name}")
    print(f"{n} tests passed")
