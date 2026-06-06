#!/usr/bin/env python3
"""Tests for todo_guard.lost_unfinished -- the unfinished-todo-deletion LIFESAVER.

Pure over (before_text, after_text); no real TODO.md / log touched.
Run: python3 tools/HME/scripts/test_todo_guard.py
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_H = "### Todo - Set 3\n"


def _run():
    # Isolate PROJECT_ROOT so any log write hits a temp dir.
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
    for name, before, after, expect in cases:
        got = len(lost(before, after))
        if got != expect:
            failures.append(f"{name}: expected {expect} lost, got {got}")

    # main() archive rescue: an item dropped from the active file but recorded
    # 5_-done in an on-disk set*.md archive must NOT raise a LIFESAVER (it was
    archive_dir = Path(d) / "log" / "todo"
    (archive_dir / "set9.md").write_text(
        "### Todo - Set 9\n#7 5_ build the durable guard\n", encoding="utf-8"
    )
    before_p = Path(d) / "before.md"
    after_p = Path(d) / "after.md"
    before_p.write_text("### Todo - Set 9\n#7 0_ build the durable guard\n", encoding="utf-8")
    after_p.write_text("### Todo - Set 10\n", encoding="utf-8")
    rc_archived = g.main([str(before_p), str(after_p)])
    if rc_archived != 0:
        failures.append("main archive rescue: archived-5_ item must not fire LIFESAVER")
        print("[FAIL] main archive rescue (archived-5_ item)")
    else:
        print("[pass] main archive rescue (archived-5_ item)")

    before_p.write_text("### Todo - Set 9\n#8 0_ genuinely unrelated lost work\n", encoding="utf-8")
    rc_lost = g.main([str(before_p), str(after_p)])
    if rc_lost != 1:
        failures.append("main archive rescue: genuinely lost non-5_ item must fire LIFESAVER")
        print("[FAIL] main genuine loss still fires")
    else:
        print("[pass] main genuine loss still fires")

    if failures:
        print(f"\n{len(failures)} test(s) failed")
        return 1
    print(f"\nall {len(cases) + 2} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(_run())
