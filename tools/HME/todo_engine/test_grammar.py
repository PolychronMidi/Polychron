"""Round-trip + edge tests for todo_engine.grammar. Run: python3 -m pytest (or直接)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from grammar import (  # noqa: E402
    Todo, parse_line, render_line, parse_document, render_document, DEFAULT_MINUTES,
)


def _rt(line):
    t = parse_line(line)
    assert t is not None, f"failed to parse: {line!r}"
    return render_line(t)


def test_basic_codes():
    for code in ("0", "1", "2", "3", "4", "4f", "5"):
        t = parse_line(f"#7 {code}_ do a thing")
        assert t is not None and t.code == code and t.id == 7
        assert t.text == "do a thing"


def test_timer_default_and_custom():
    assert parse_line("#1 2_ revisit").effective_minutes() == DEFAULT_MINUTES["2"]
    assert parse_line("#1 2_60 revisit").effective_minutes() == 60
    assert parse_line("#2 4f_ follow").effective_minutes() == DEFAULT_MINUTES["4f"]
    assert parse_line("#2 4f_90 follow").effective_minutes() == 90
    assert parse_line("#3 0_ plain").effective_minutes() is None


def test_qualifier_roundtrip():
    line = '#5 4f_ ship docs _q="after review lands"'
    t = parse_line(line)
    assert t.qualifier == "after review lands"
    assert 'ship docs' in render_line(t) and '_q="after review lands"' in render_line(t)


def test_since_anchor_roundtrip():
    line = "#9 2_30 recheck cache <!-- since:1779990000 -->"
    t = parse_line(line)
    assert t.since == 1779990000.0 and t.minutes == 30
    assert "since:1779990000" in render_line(t)


def test_non_timed_drops_since_on_render():
    t = Todo(id=4, code="0", text="x", since=123.0)
    assert "since" not in render_line(t)


def test_document_roundtrip():
    doc = (
        "# File Format Rules: ...\n"
        "0_ default\n"
        "\n"
        "### Todo - Set 1\n"
        "\n"
        "#1 1_ in progress task\n"
        "#2 4f_ followup _q=\"needs X\"\n"
        '#3 2_45 revisit later <!-- since:1779990000 -->\n'
    )
    header, todos = parse_document(doc)
    assert len(todos) == 3
    assert todos[0].code == "1" and todos[1].qualifier == "needs X"
    assert todos[2].minutes == 45 and todos[2].since == 1779990000.0
    # re-render and re-parse: todo set must be identical
    rendered = render_document(header, todos)
    _, todos2 = parse_document(rendered)
    assert [(t.id, t.code, t.text, t.minutes, t.qualifier, t.since) for t in todos] == \
           [(t.id, t.code, t.text, t.minutes, t.qualifier, t.since) for t in todos2]


def test_non_todo_lines_ignored():
    assert parse_line("just prose") is None
    assert parse_line("## Section") is None
    assert parse_line("") is None


if __name__ == "__main__":
    n = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            n += 1
            print(f"  ok {name}")
    print(f"{n} tests passed")
