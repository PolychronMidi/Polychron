#!/usr/bin/env python3
"""Tests for todo_guard.lost_unfinished -- the unfinished-todo-deletion LIFESAVER.

Pure over (before_text, after_text[, archive]); no real TODO.md / log touched.
Run: python3 tools/HME/scripts/test_todo_guard.py
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_H = "### Todo - Set 3\n"


def _run():
    # Isolate PROJECT_ROOT so archive scan + any log write hit a temp dir.
    d = tempfile.mkdtemp(prefix="todo-guard-test-")
    os.environ["PROJECT_ROOT"] = d
    (Path(d) / "log" / "todo").mkdir(parents=True, exist_ok=True)
    for m in ("todo_guard", "todo_engine.grammar"):
        sys.modules.pop(m, None)
    import todo_guard as g

    def lost(before, after):
        return g.lost_unfinished(before, after)

    cases = [
        # name, before, after, expect_lost_count
        ("drop unfinished 0_ (THE failure)", _H + "#1 0_ get HCI score to 100",
         "### Todo - Set 4\n#1 0_ different", 1),
        ("status flip 0_->5_ (id survives)", _H + "#1 0_ ship", _H + "#1 5_ ship", 0),
        ("completed 5_ pruned (ok)", _H + "#1 5_ done", "### Todo - Set 4\n", 0),
        ("canonical archive carries non-5_", "### Todo - Set 4\n#1 0_ build the guard",
         "### Todo - Set 5\n#1 0_ build the guard", 0),
        ("archive without carry loses non-5_", "### Todo - Set 4\n#1 0_ build the guard",
         "### Todo - Set 5\n", 1),
        ("text edit, id survives", _H + "#1 0_ old wording", _H + "#1 0_ new wording", 0),
        ("renumber, text survives", _H + "#1 0_ kept body", _H + "#9 0_ kept body", 0),
        ("drop in-progress 1_", _H + "#1 1_ wip\n#2 0_ keep", _H + "#2 0_ keep", 1),
        ("drop blocked 3_", _H + "#3 3_ blocked", "### Todo - Set 4\n", 1),
        ("drop two unfinished", _H + "#1 0_ a\n#2 1_ b\n#3 5_ c",
         "### Todo - Set 4\n#3 5_ c", 2),
        ("no before -> no fire", "", _H + "#1 0_ x", 0),
    ]
    failures = []
    for name, before, after, expect in cases:
        got = len(lost(before, after))
        if got != expect:
            failures.append(f"{name}: expected {expect} lost, got {got}")
            print(f"[FAIL] {name}: expected {expect} got {got}")
        else:
            print(f"[pass] {name}")

    # Wrong-number archive must not hide deletion from the turn-start Set 4.
    wrong = lost("### Todo - Set 4\n#1 0_ build the guard", "### Todo - Set 5\n", archive=None)
    assert len(wrong) == 1
    if failures:
        print(f"\n{len(failures)} test(s) failed")
        return 1
    print(f"\nall {len(cases)} tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(_run())
