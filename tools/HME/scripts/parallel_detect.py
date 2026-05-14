#!/usr/bin/env python3
"""Independent-set detection for SPEC.md Phase items. Adapted from egregore:parallel.

Given a Phase block from SPEC.md, group its open `- [ ]` items by file-overlap
independence. Items that touch disjoint file sets can run in parallel via separate
Agent subagents (with `isolation: worktree` for collision-safety). Items that
share files must run sequentially.

Heuristic: extract `[file_path](file_path)` markdown link refs from each item's
text; two items are independent iff their file-ref sets are disjoint.

Output: ranked groups (largest independent set first), human-readable + JSON.

Usage:
  i/audit parallel              # latest Phase
  i/audit parallel --phase 3    # explicit Phase number
  i/audit parallel --json       # machine output
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])
_SPEC = _PROJECT / "doc" / "templates" / "SPEC.md"

_PHASE_HEADER_RE = re.compile(r"^###\s+Phase\s+(\d+)\s*:")
_OPEN_ITEM_RE = re.compile(r"^\s*-\s+\[\s\]\s+\[(E[1-5]|easy|medium|hard)\]\s+(.+?)\s*$",
                           re.IGNORECASE)
_FILE_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)|`([^`]+\.(?:py|js|ts|sh|md|json))`")


def _read_phase(n: int | str) -> tuple[int, list[tuple[str, str]]]:
    """Return (phase_n, [(tier, body), ...]) for the requested Phase. n='latest'
    resolves to highest-numbered. Empty list = phase missing."""
    if not _SPEC.is_file():
        return (0, [])
    text = _SPEC.read_text(encoding="utf-8")
    lines = text.splitlines()
    headers = [(int(m.group(1)), i) for i, ln in enumerate(lines)
               for m in [_PHASE_HEADER_RE.match(ln)] if m]
    if not headers:
        return (0, [])
    if n == "latest":
        target_n = max(h for h, _ in headers)
    else:
        try:
            target_n = int(n)
        except (TypeError, ValueError):
            return (0, [])
    target_idx = next((i for h, i in headers if h == target_n), None)
    if target_idx is None:
        return (target_n, [])
    next_idx = next((i for h, i in headers if i > target_idx), len(lines))
    for i in range(target_idx + 1, next_idx):
        if lines[i].startswith("## "):
            next_idx = i
            break
    items = []
    for ln in lines[target_idx + 1:next_idx]:
        m = _OPEN_ITEM_RE.match(ln)
        if m:
            items.append((m.group(1), m.group(2).strip()))
    return (target_n, items)


def _file_refs(body: str) -> set[str]:
    """Extract file references from a Phase item body. Returns normalized
    repo-relative paths; an empty set means 'unknown scope, treat as
    overlapping with everything' (conservative)."""
    refs = set()
    for m in _FILE_LINK_RE.finditer(body):
        ref = m.group(1) or m.group(2) or ""
        ref = ref.strip()
        if not ref or ref.startswith("http"):
            continue
        if "/" in ref or "." in ref:
            refs.add(ref.lstrip("./"))
    return refs


def _independent_groups(items: list[tuple[str, str]]) -> list[list[int]]:
    """Greedy bucket: each item joins an existing group iff it has zero file-ref
    overlap with every member; otherwise opens a new group. Returns groups as
    lists of item indices (0-based into `items`)."""
    item_refs = [_file_refs(body) for _, body in items]
    groups: list[list[int]] = []
    group_refs: list[set[str]] = []
    for i, refs in enumerate(item_refs):
        if not refs:
            groups.append([i])
            group_refs.append(set())
            continue
        placed = False
        for g, gr in enumerate(group_refs):
            if not gr or refs.isdisjoint(gr):
                groups[g].append(i)
                group_refs[g] |= refs
                placed = True
                break
        if not placed:
            groups.append([i])
            group_refs.append(set(refs))
    return groups


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", default="latest", help="phase number or 'latest'")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    phase_n, items = _read_phase(args.phase)
    if not items:
        print(f"parallel-detect: Phase {phase_n} has no open items")
        return 0
    groups = _independent_groups(items)
    if args.json:
        print(json.dumps({
            "phase": phase_n,
            "items": [{"i": i, "tier": t, "body": b[:120]} for i, (t, b) in enumerate(items)],
            "groups": [[i for i in g] for g in groups],
        }, indent=2))
        return 0
    print(f"parallel-detect: Phase {phase_n}, {len(items)} item(s) -> {len(groups)} independent group(s)")
    for gi, g in enumerate(groups):
        print(f"  Group {gi + 1} ({len(g)} item{'s' if len(g) != 1 else ''} parallel-safe):")
        for i in g:
            tier, body = items[i]
            refs = _file_refs(body) or {"<unknown scope>"}
            print(f"    [{tier}] {body[:90]}")
            print(f"          touches: {', '.join(sorted(refs)[:4])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
