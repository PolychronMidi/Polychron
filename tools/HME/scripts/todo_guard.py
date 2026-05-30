#!/usr/bin/env python3
"""LIFESAVER guard: never silently lose an unfinished todo from doc/templates/TODO.md.

Compares a BEFORE snapshot of TODO.md against the current/AFTER file. Any todo
that was unfinished (status code != 5_) in BEFORE and is now GONE from AFTER --
its id absent AND its text absent -- without having been archived to log/todo/
raises a LIFESAVER (agent-origin line in log/hme-errors.log) so the deletion
cannot pass silently. Completed (5_) todos may be pruned; set-archival is allowed
(an archived todo's text is found under log/todo/set<N>.md).

Uses the canonical todo_engine grammar -- one parser, no format drift.

Usage: todo_guard.py <before_file> <after_file>
Exit 1 (+ LIFESAVER written) when an unfinished todo was lost, else 0. Never
raises into the caller -- a guard that crashes must not break the write path.
"""
from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path

_HME = Path(__file__).resolve().parents[1]  # tools/HME
if str(_HME) not in sys.path:
    sys.path.insert(0, str(_HME))
from todo_engine.grammar import parse_document  # noqa: E402


def _root() -> Path:
    return Path(os.environ.get("PROJECT_ROOT") or _HME.parent.parent)  # env-ok: runtime root


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def _todos(text: str):
    _header, todos = parse_document(text or "")
    return todos


def _archived_texts() -> set:
    d = _root() / "log" / "todo"
    out: set = set()
    if not d.is_dir():
        return out
    for f in d.glob("set*.md"):
        try:
            for t in _todos(f.read_text(encoding="utf-8")):
                out.add(_norm(t.text))
        except OSError:
            pass  # silent-ok: best-effort archive scan
    return out


def lost_unfinished(before_text: str, after_text: str) -> list:
    """Return BEFORE todos with code != 5 whose id AND text both vanished from
    AFTER and that were not archived. id-survival tolerates status flips and
    text edits; text-survival tolerates set renumbering."""
    before = _todos(before_text)
    after = _todos(after_text)
    after_ids = {t.id for t in after}
    after_texts = {_norm(t.text) for t in after}
    archived = _archived_texts()
    lost = []
    for t in before:
        if t.code == "5":
            continue
        if t.id in after_ids:
            continue
        nt = _norm(t.text)
        if nt in after_texts or nt in archived:
            continue
        lost.append(t)
    return lost


def main(argv: list) -> int:
    if len(argv) < 2:
        return 0
    try:
        before_p, after_p = Path(argv[0]), Path(argv[1])
        before = before_p.read_text(encoding="utf-8") if before_p.is_file() else ""
        after = after_p.read_text(encoding="utf-8") if after_p.is_file() else ""
        if not before.strip():
            return 0
        lost = lost_unfinished(before, after)
        if not lost:
            return 0
        detail = " | ".join(f"#{t.id} {t.code}_ {t.text}" for t in lost)
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        log = _root() / "log" / "hme-errors.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        with open(log, "a", encoding="utf-8") as fh:
            fh.write(
                f"[{ts}] [todo-guard] LIFESAVER - UNFINISHED TODO DELETED from "
                f"doc/templates/TODO.md ({len(lost)}): {detail} -- RESTORE the dropped "
                f"item(s) verbatim, or mark them 5_/archive. NEVER drop a non-5_ todo silently.\n"
            )
        sys.stderr.write(f"[todo-guard] LIFESAVER: {len(lost)} unfinished todo(s) deleted: {detail}\n")
        return 1
    except Exception as exc:  # a guard must never break the write path
        sys.stderr.write(f"[todo-guard] guard error (non-fatal): {type(exc).__name__}: {exc}\n")
        return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
