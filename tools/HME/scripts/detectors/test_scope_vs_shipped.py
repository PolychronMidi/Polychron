#!/usr/bin/env python3
"""Tests for scope_vs_shipped.py. Exercises diff parsing + verdict matrix
against the todo_engine status-code grammar (0_ created, 5_ done)."""
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


def _verdict_for(new_open, completed, non_spec_edits):
    scope_stacked = new_open > 0 and completed == 0
    scope_not_tracked = non_spec_edits > 0 and completed == 0 and not scope_stacked
    if scope_stacked and scope_not_tracked:
        return "scope-stacked+not-tracked"
    if scope_stacked:
        return "scope-stacked"
    if scope_not_tracked:
        return "scope-not-tracked"
    return "ok"


def _run_all():
    diff_added = """+#1 0_ First new item
+#2 0_ Second new item
+#3 0_ Third new item
+some unrelated context line
"""
    assert_eq(svs._count_new_open(diff_added), 3, "3 new open items counted")
    assert_eq(svs._count_completed(diff_added), 0, "0 completed when no 5_ added")

    diff_transition = """-#4 0_ some item description
+#4 5_ some item description
"""
    assert_eq(svs._count_new_open(diff_transition), -1, "completion removes 0_, net -1 open")
    assert_eq(svs._count_completed(diff_transition), 1, "1 completion counted")

    diff_mixed = """-#5 0_ item that gets done
+#5 5_ item that gets done
+#6 0_ brand new item one
+#7 0_ brand new item two
"""
    assert_eq(svs._count_new_open(diff_mixed), 1, "2 added - 1 removed = 1 net new open")
    assert_eq(svs._count_completed(diff_mixed), 1, "1 completion in mixed diff")

    assert_eq(svs._count_new_open(""), 0, "empty diff -> 0 new open")
    assert_eq(svs._count_completed(""), 0, "empty diff -> 0 completed")

    # in-progress (1_) and revisit (2_) are neither new-open-created nor done
    diff_inprogress = """+#8 1_ now working on this
+#9 2_ revisit later
"""
    assert_eq(svs._count_new_open(diff_inprogress), 0, "1_/2_ are not new 0_ items")
    assert_eq(svs._count_completed(diff_inprogress), 0, "1_/2_ are not completions")

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

    assert_eq(_verdict_for(3, 0, 0), "scope-stacked", "3 new open, none done, no edits -> scope-stacked")
    assert_eq(_verdict_for(0, 0, 5), "scope-not-tracked", "5 non-TODO edits, no completions -> scope-not-tracked")
    assert_eq(_verdict_for(0, 1, 5), "ok", "5 edits + 1 completion -> ok")
    assert_eq(_verdict_for(2, 1, 5), "ok", "2 new but 1 done -> ok (work is happening)")
    assert_eq(_verdict_for(0, 0, 0), "ok", "no activity -> ok")

    if failures:
        print(f"\n{len(failures)} test(s) failed")
        return 1
    print(f"\nall tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(_run_all())
