#!/usr/bin/env python3
"""Detect newly-flipped `[ ] -> [x]` items in SPEC.md and ship them to TODO.md.

PostToolUse hook on Edit/Write to doc/templates/SPEC.md. Diffs against git HEAD
to find checkbox flips this turn, appends each to TODO.md "Just shipped",
trims to the rolling-10 cap. Matching HME todo entries are marked done by text
prefix when text overlap >= 30 chars (mirrors close_with_spec_update logic).

Idempotent + safe-on-error: any exception falls through to no-op.

Usage: spec_autoflip.py  (reads PROJECT_ROOT from env)
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])
_SPEC = _PROJECT / "doc" / "templates" / "SPEC.md"
_TODO = _PROJECT / "doc" / "templates" / "TODO.md"
_JUST_SHIPPED_CAP = 10

_FLIPPED_RE = re.compile(r"^\s*-\s+\[x\]\s+\[(E[1-5]|easy|medium|hard)\]\s+(.+?)\s*$",
                         re.IGNORECASE)
_OPEN_RE = re.compile(r"^\s*-\s+\[\s\]\s+\[(E[1-5]|easy|medium|hard)\]\s+(.+?)\s*$",
                      re.IGNORECASE)


def _read_spec_at(ref: str) -> str:
    try:
        proc = subprocess.run(
            ["git", "-C", str(_PROJECT), "show", f"{ref}:doc/templates/SPEC.md"],
            capture_output=True, text=True, timeout=5,
        )
        if proc.returncode == 0:
            return proc.stdout
    except (OSError, subprocess.SubprocessError):
        pass  # silent-ok: best-effort fs op
    return ""


def _read_head_spec() -> str:
    """Return the pre-edit SPEC.md content. If HEAD == working tree (autocommit
    already captured this turn's edit), walk back to HEAD~1 so the diff is meaningful.
    Solves the race where autocommit beats spec_autoflip to disk."""
    try:
        cur = _SPEC.read_text(encoding="utf-8")
    except OSError:
        return _read_spec_at("HEAD")
    head = _read_spec_at("HEAD")
    if head and head == cur:
        prev = _read_spec_at("HEAD~1")
        if prev:
            return prev
    return head


def _items(text: str, regex: re.Pattern) -> set[str]:
    out = set()
    for line in text.splitlines():
        m = regex.match(line)
        if m:
            out.add(f"[{m.group(1)}] {m.group(2).strip()}")
    return out


def _newly_flipped() -> list[str]:
    """Return items shipped this turn. Two kinds count:
      A. Transition: line was `- [ ]` in HEAD, now `- [x]` (classic flip).
      B. Birth-as-shipped: line is `- [x]` in current and DIDN'T EXIST in HEAD
         (item added directly at completed state, e.g. retroactive documentation
         or single-edit-write-and-flip pattern this session demonstrated).
    Both deserve a Just-shipped entry; both reflect work that landed this turn."""
    if not _SPEC.is_file():
        return []
    head = _read_head_spec()
    cur_text = _SPEC.read_text(encoding="utf-8")
    cur_flipped = _items(cur_text, _FLIPPED_RE)
    if not head:
        return sorted(cur_flipped)
    head_open = _items(head, _OPEN_RE)
    head_flipped = _items(head, _FLIPPED_RE)
    transitioned = head_open & cur_flipped
    birth_as_shipped = cur_flipped - head_open - head_flipped
    return sorted(transitioned | birth_as_shipped)


def _trim_just_shipped(lines: list[str]) -> list[str]:
    """Keep at most _JUST_SHIPPED_CAP entries (newest first)."""
    bullets = [ln for ln in lines if ln.strip().startswith("- ")]
    keep = bullets[:_JUST_SHIPPED_CAP]
    non_bullets = [ln for ln in lines if not ln.strip().startswith("- ")]
    return keep + non_bullets


def _ship_to_todo(items: list[str]) -> int:
    if not items or not _TODO.is_file():
        return 0
    md = _TODO.read_text(encoding="utf-8")
    marker = "## Just shipped (last cycle)"
    if marker not in md:
        return 0
    head_part, _, tail = md.partition(marker)
    next_marker_pos = tail.find("\n## ")
    if next_marker_pos == -1:
        section, after = tail, ""
    else:
        section, after = tail[:next_marker_pos], tail[next_marker_pos:]
    section_lines = section.splitlines()
    existing_bullets = {
        ln.strip() for ln in section_lines if ln.strip().startswith("- ")
    }
    added = 0
    new_bullets = []
    for it in items:
        bullet = f"- {it} (auto-shipped from SPEC checkbox flip)"
        if bullet in existing_bullets:
            continue
        new_bullets.append(bullet)
        added += 1
    if not new_bullets:
        return 0
    other_bullets = [ln for ln in section_lines if ln.strip().startswith("- ")]
    non_bullets = [ln for ln in section_lines if not ln.strip().startswith("- ")]
    merged_bullets = new_bullets + other_bullets
    trimmed = merged_bullets[:_JUST_SHIPPED_CAP]
    section_out = "\n".join(non_bullets + ([""] if non_bullets and trimmed else []) + trimmed)
    if not section_out.endswith("\n"):
        section_out += "\n"
    new_md = head_part + marker + "\n" + section_out + after
    _TODO.write_text(new_md, encoding="utf-8")
    return added


def main() -> int:
    try:
        items = _newly_flipped()
        if not items:
            return 0
        added = _ship_to_todo(items)
        if added:
            sys.stderr.write(
                f"[spec_autoflip] {added} SPEC item(s) auto-shipped to TODO.md Just shipped\n"
            )
    except Exception as e:
        sys.stderr.write(f"[spec_autoflip] silent-ok: {type(e).__name__}: {e}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
