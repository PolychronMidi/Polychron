#!/usr/bin/env python3
"""Tests for scope_vs_shipped.py. Exercises diff parsing + verdict matrix."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import scope_vs_shipped as svs  # noqa: E402

failures = []


def assert_eq(actual, expected, msg):
    if actual != expected:
        failures.append(f"{msg}: expected {expected!r}, got {actual!r}")
        print(f"[FAIL] {msg}: expected {expected!r}, got {actual!r}")
    else:
        print(f"[pass] {msg}")


def _verdict_for(new_unchecked, ticked, non_spec_edits):
    scope_stacked = new_unchecked > 0 and ticked == 0
    scope_not_tracked = non_spec_edits > 0 and ticked == 0 and not scope_stacked
    if scope_stacked and scope_not_tracked:
        return "scope-stacked+not-tracked"
    if scope_stacked:
        return "scope-stacked"
    if scope_not_tracked:
        return "scope-not-tracked"
    return "ok"


def _run_all():
    diff_added = """+- [ ] First new item
+- [ ] Second new item
+- [ ] Third new item
+some unrelated context line
"""
    assert_eq(svs._count_new_unchecked(diff_added), 3, "3 new unchecked items counted")
    assert_eq(svs._count_ticked_transitions(diff_added), 0, "0 ticked transitions when no [x] added")

    diff_transition = """-- [ ] some item description
+- [x] some item description
"""
    assert_eq(svs._count_new_unchecked(diff_transition), -1, "transition removes [ ], net -1 unchecked")
    assert_eq(svs._count_ticked_transitions(diff_transition), 1, "1 ticked transition counted")

    diff_mixed = """-- [ ] item that gets ticked
+- [x] item that gets ticked
+- [ ] brand new item one
+- [ ] brand new item two
"""
    assert_eq(svs._count_new_unchecked(diff_mixed), 1, "2 added - 1 removed = 1 net new unchecked")
    assert_eq(svs._count_ticked_transitions(diff_mixed), 1, "1 ticked transition in mixed diff")

    assert_eq(svs._count_new_unchecked(""), 0, "empty diff -> 0 new unchecked")
    assert_eq(svs._count_ticked_transitions(""), 0, "empty diff -> 0 transitions")

    diff_indented = """+  - [ ] indented unchecked item
"""
    assert_eq(svs._count_new_unchecked(diff_indented), 1, "indented unchecked item counted")

    events_no_edits = [{"type": "assistant", "message": {"content": [{"type": "text", "text": "hello"}]}}]
    assert_eq(svs._turn_edited_non_spec(events_no_edits), 0, "no edits -> 0 non-spec")

    events_with_edit = [{
        "type": "assistant",
        "message": {"content": [
            {"type": "tool_use", "name": "Edit", "input": {"file_path": "/foo/bar.py"}},
            {"type": "tool_use", "name": "Edit", "input": {"file_path": "/proj/doc/templates/TODO.md"}},
            {"type": "tool_use", "name": "Write", "input": {"file_path": "/foo/baz.js"}},
        ]},
    }]
    assert_eq(svs._turn_edited_non_spec(events_with_edit), 2, "2 non-TODO edits, TODO.md excluded")

    assert_eq(_verdict_for(3, 0, 0), "scope-stacked", "3 new unchecked, no ticks, no edits -> scope-stacked")
    assert_eq(_verdict_for(0, 0, 5), "scope-not-tracked", "5 non-TODO edits, no TODO ticks -> scope-not-tracked")
    assert_eq(_verdict_for(0, 1, 5), "ok", "5 edits + 1 TODO tick -> ok")
    assert_eq(_verdict_for(2, 1, 5), "ok", "2 new but 1 ticked -> ok (work is happening)")
    assert_eq(_verdict_for(0, 0, 0), "ok", "no activity -> ok")

    if failures:
        print(f"\n{len(failures)} test(s) failed")
        return 1
    print(f"\nall tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(_run_all())
