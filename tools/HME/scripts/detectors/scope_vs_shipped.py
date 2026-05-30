#!/usr/bin/env python3
"""Stop-time check: declared TODO scope vs shipped artifacts.

Existing work-avoidance detectors operate on closing text. This detector cross-checks doc/templates/TODO.md completions against files changed this turn, using the todo_engine status-code grammar (0_ = created/open, 5_ = done).

This detector fires two signals from the cross-reference:

  scope-stacked       TODO.md grew open items this turn (net new '#<id> 0_'
                      lines, not 0_ -> 5_ completions) AND zero items reached
                      5_ in the same turn. Translation: agent ENUMERATED MORE
                      WORK than it DID -- TODO grows faster than artifacts.

  scope-not-tracked   Turn made substantive Edit/Write/MultiEdit calls to
                      non-TODO files AND zero TODO items reached 5_. Translation:
                      agent shipped artifacts but didn't update declared
                      scope -- either work was off-list or TODO stale.

Both verdicts are advisory (printed, observable in detector-stats.jsonl) so the operator can see scope drift even when phrase-detectors stay silent.

Usage: scope_vs_shipped.py <transcript_path>
Output: "ok" | "scope-stacked" | "scope-not-tracked" | "scope-stacked+not-tracked"
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transcript import load_turn_events, iter_tool_uses  # noqa: E402

_HERE = Path(__file__).resolve().parent
_PROJECT = Path(os.environ.get("PROJECT_ROOT") or _HERE.parent.parent.parent.parent)
_TODO_PATH = "doc/templates/TODO.md"
_WORK_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}


def _todo_diff() -> str:
    snapshot = _PROJECT / "tmp" / "todo-turn-start.md"
    todo = _PROJECT / _TODO_PATH
    if snapshot.is_file() and todo.is_file():
        try:
            rc = subprocess.run(
                ["diff", "-u", str(snapshot), str(todo)],
                capture_output=True, text=True, timeout=5,
            )
            return rc.stdout or ""
        except (OSError, subprocess.SubprocessError):
            pass  # silent-ok: best-effort fs op
    try:
        rc = subprocess.run(
            ["git", "diff", "HEAD", "--", _TODO_PATH],
            cwd=str(_PROJECT), capture_output=True, text=True, timeout=5,
        )
        return rc.stdout or ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _line_body(ln: str, marker: str) -> str:
    """Strip exactly one leading diff marker (+/-) then leading whitespace, leaving the original file-line content for substring tests. lstrip(marker) would over-strip when the underlying bullet itself starts with the same character."""
    return ln[1:].lstrip() if ln.startswith(marker) else ln


_NEW_OPEN_RE = re.compile(r"^#\d+\s+0_\s")
_DONE_RE = re.compile(r"^#\d+\s+5_\s")


def _count_new_open(diff: str) -> int:
    """Net new open items this turn: added '#<id> 0_' lines minus removed ones. 0_ is the default code on creation, so a net increase means the agent enumerated MORE work. A 0_ -> 5_ completion removes a 0_ and adds a 5_, so it nets to 0 here (correct -- completing an item is not enumerating one)."""
    plus = sum(1 for ln in diff.splitlines() if ln.startswith("+") and not ln.startswith("+++") and _NEW_OPEN_RE.match(_line_body(ln, "+")))
    minus = sum(1 for ln in diff.splitlines() if ln.startswith("-") and not ln.startswith("---") and _NEW_OPEN_RE.match(_line_body(ln, "-")))
    return plus - minus


def _count_completed(diff: str) -> int:
    """Count of added '#<id> 5_' lines. Each is an item marked done totally this turn -- the shipped-work signal."""
    return sum(1 for ln in diff.splitlines() if ln.startswith("+") and not ln.startswith("+++") and _DONE_RE.match(_line_body(ln, "+")))


def _turn_edited_non_spec(events: list) -> int:
    """Count Edit/Write/MultiEdit tool_use blocks targeting files other than TODO.md."""
    n = 0
    for ev in events:
        for tu in iter_tool_uses(ev):
            if tu.get("name") not in _WORK_TOOLS:
                continue
            fp = (tu.get("input") or {}).get("file_path", "") or ""
            if fp and _TODO_PATH not in fp:
                n += 1
    return n


def _emit_stats(verdict: str, detail: str) -> None:
    from _detector_stats import emit_stats
    emit_stats("scope_vs_shipped", verdict, detail)



def _turn_invoked_todo_archive(events: list) -> bool:
    """True if this turn invoked the HME todo archive/clear maintenance path.
    The devlog write IS proof-of-shipped; counting it as scope-not-tracked
    is a false positive."""
    import re as _re
    archive_pat = _re.compile(
        r"\bhme_todo\b.*\baction=clear\b|"
        r"\baction=clear\b.*\bhme_todo\b|"
        r"\bhme_admin\b.*\baction=todo_archive\b|"
        r"\baction=todo_archive\b.*\bhme_admin\b"
    )
    for ev in events:
        for tu in iter_tool_uses(ev):
            if tu.get("name") != "Bash":
                continue
            cmd = (tu.get("input") or {}).get("command", "") or ""
            if archive_pat.search(cmd):
                return True
    return False


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_turn_events(sys.argv[1])
    if _turn_invoked_todo_archive(events):
        _emit_stats("ok", "todo archive invoked -- sanctioned completion event")
        print("ok")
        return 0
    diff = _todo_diff()
    new_open = _count_new_open(diff)
    completed = _count_completed(diff)
    non_spec_edits = _turn_edited_non_spec(events)

    scope_stacked = new_open > 0 and completed == 0
    scope_not_tracked = non_spec_edits > 0 and completed == 0 and not scope_stacked

    if scope_stacked and scope_not_tracked:
        verdict = "scope-stacked+not-tracked"
    elif scope_stacked:
        verdict = "scope-stacked"
    elif scope_not_tracked:
        verdict = "scope-not-tracked"
    else:
        verdict = "ok"

    detail = f"new_open={new_open} completed={completed} non_spec_edits={non_spec_edits}"
    _emit_stats(verdict, detail)
    print(verdict)
    return 0


if __name__ == "__main__":
    sys.exit(main())
