#!/usr/bin/env python3
"""Stop-time check: declared SPEC scope vs shipped artifacts.

Existing work-avoidance detectors (psycho_stop, exhaust_check, stop_work, ack_skip) all operate on the assistant's closing TEXT, phrase-matching deferral language. They are structurally blind to: scope declared in SPEC.md vs artifacts the turn actually shipped. The agent can ship 30% of a SPEC and pass every existing detector simply by closing tersely (no enumerated punts, no permission-asks).

This detector fires two signals from the cross-reference:

  scope-stacked       SPEC.md grew unchecked items this turn ([ ] count
                      increased via real adds, not [ ] -> [x] reversions)
                      AND zero [ ] -> [x] transitions happened in the same
                      turn. Translation: agent ENUMERATED MORE WORK than it
                      DID -- the SPEC accumulates faster than artifacts.

  scope-not-tracked   Turn made substantive Edit/Write/MultiEdit calls to
                      non-SPEC files AND zero SPEC items ticked. Translation:
                      agent shipped artifacts but didn't update declared
                      scope -- either work was off-spec or SPEC stale.

Both verdicts are advisory (printed, observable in detector-stats.jsonl) so the operator can see scope drift even when phrase-detectors stay silent.

Usage: scope_vs_shipped.py <transcript_path>
Output: "ok" | "scope-stacked" | "scope-not-tracked" | "scope-stacked+not-tracked"
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transcript import load_turn_events, iter_tool_uses  # noqa: E402

_HERE = Path(__file__).resolve().parent
_PROJECT = Path(os.environ.get("PROJECT_ROOT") or _HERE.parent.parent.parent.parent)
_SPEC_PATH = "doc/templates/SPEC.md"
_WORK_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}


def _spec_diff() -> str:
    """Diff this turn's SPEC.md vs the turn-start snapshot taken by userpromptsubmit.sh. Falls back to `git diff HEAD` only when the snapshot is missing (first-run install). Snapshot is load-bearing because autocommit syncs HEAD <-> working tree mid-turn -- `git diff HEAD` returns empty even after legitimate SPEC ticks landed and got autocommitted."""
    snapshot = _PROJECT / "tmp" / "spec-turn-start.md"
    spec = _PROJECT / _SPEC_PATH
    if snapshot.is_file() and spec.is_file():
        try:
            rc = subprocess.run(
                ["diff", "-u", str(snapshot), str(spec)],
                capture_output=True, text=True, timeout=5,
            )
            return rc.stdout or ""
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        rc = subprocess.run(
            ["git", "diff", "HEAD", "--", _SPEC_PATH],
            cwd=str(_PROJECT), capture_output=True, text=True, timeout=5,
        )
        return rc.stdout or ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _line_body(ln: str, marker: str) -> str:
    """Strip exactly one leading diff marker (+/-) then leading whitespace, leaving the original file-line content for substring tests. lstrip(marker) would over-strip when the underlying bullet itself starts with the same character."""
    return ln[1:].lstrip() if ln.startswith(marker) else ln


def _count_new_unchecked(diff: str) -> int:
    """Net new unchecked items: added '- [ ]' lines minus removed '- [ ]' lines. [ ] -> [x] transitions remove an old [ ] and add a new [x], so they net to 0 here (correct -- a transition is not a new item)."""
    plus = sum(1 for ln in diff.splitlines() if ln.startswith("+") and not ln.startswith("+++") and _line_body(ln, "+").startswith("- [ ]"))
    minus = sum(1 for ln in diff.splitlines() if ln.startswith("-") and not ln.startswith("---") and _line_body(ln, "-").startswith("- [ ]"))
    return plus - minus


def _count_ticked_transitions(diff: str) -> int:
    """Count of added '- [x]' lines. Each represents either a [ ] -> [x] transition or a freshly-added already-ticked item; both indicate shipped work."""
    return sum(1 for ln in diff.splitlines() if ln.startswith("+") and not ln.startswith("+++") and _line_body(ln, "+").startswith("- [x]"))


def _turn_edited_non_spec(events: list) -> int:
    """Count Edit/Write/MultiEdit tool_use blocks targeting files other than SPEC.md."""
    n = 0
    for ev in events:
        for tu in iter_tool_uses(ev):
            if tu.get("name") not in _WORK_TOOLS:
                continue
            fp = (tu.get("input") or {}).get("file_path", "") or ""
            if fp and _SPEC_PATH not in fp:
                n += 1
    return n


def _emit_stats(verdict: str, detail: str) -> None:
    try:
        out_path = _PROJECT / "output" / "metrics" / "detector-stats.jsonl"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "ts": time.time(),
                "detector": "scope_vs_shipped",
                "verdict": verdict,
                "detail": detail,
            }) + "\n")
    except OSError as e:
        print(f"[scope_vs_shipped] stats emit failed: {type(e).__name__}: {e}", file=sys.stderr)


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_turn_events(sys.argv[1])
    diff = _spec_diff()
    new_unchecked = _count_new_unchecked(diff)
    ticked = _count_ticked_transitions(diff)
    non_spec_edits = _turn_edited_non_spec(events)

    scope_stacked = new_unchecked > 0 and ticked == 0
    scope_not_tracked = non_spec_edits > 0 and ticked == 0 and not scope_stacked

    if scope_stacked and scope_not_tracked:
        verdict = "scope-stacked+not-tracked"
    elif scope_stacked:
        verdict = "scope-stacked"
    elif scope_not_tracked:
        verdict = "scope-not-tracked"
    else:
        verdict = "ok"

    detail = f"new_unchecked={new_unchecked} ticked={ticked} non_spec_edits={non_spec_edits}"
    _emit_stats(verdict, detail)
    print(verdict)
    return 0


if __name__ == "__main__":
    sys.exit(main())
