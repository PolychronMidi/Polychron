#!/usr/bin/env python3
"""Devlog pattern extraction.

Walks KB devlog snapshots (`tools/HME/KB/devlog/<ts>-<slug>.md`), parses the
current TODO-era archive contract and legacy phase-era snapshots, accumulates
patterns by category, and surfaces relevant patterns for the next initiative.

Pattern categories detected:
  - tech_stack    -- recurring file-paths / module names that show up in completions
  - failure_mode  -- "what's next" items that became "manual ship", "race condition", "false positive"
  - architecture  -- worthiness-axis high-scorers from legacy phase snapshots
  - task          -- completed TODO items from current archives
  - task_tier     -- recurring completed effort tiers from current archives
  - archive       -- recurring archive/set names
  - approach      -- recurring phrases from completion paragraphs (e.g. "synchronously", "fall-through")

Storage: appends a `tools/HME/KB/learnings.jsonl` line per detected pattern,
deduped by (category, description) on read.

Usage:
  i/learn learnings extract              # walk devlog + extract new patterns
  i/learn learnings list                 # show all known patterns sorted by frequency
  i/learn learnings surface --keyword X  # patterns matching keyword
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])
_DEVLOG_DIR = _PROJECT / "tools" / "HME" / "KB" / "devlog"
_LEARNINGS = _PROJECT / "tools" / "HME" / "KB" / "learnings.jsonl"

_PHASE_HEADER_RE = re.compile(
    r"^###\s+Phase\s+(\d+)\s*:\s*(.+?)(?:\s*\(worthiness\s+P/C/S/E\s*=\s*(\d)/(\d)/(\d)/(\d)\))?\s*$"
)
_PHASE_COMPLETE_RE = re.compile(r"^_Phase\s+(\d+)\s+complete_\b")
_FILE_REF_RE = re.compile(
    r"\[[^\]]+\]\(([^)]+\.(?:py|js|ts|sh|md|json))\)|`([^`]+\.(?:py|js|ts|sh|md|json))`"
)
_TODO_TASK_RE = re.compile(
    r"^\s*-\s+\[(?P<mark>[ xX])\]\s+\[(?P<tier>E[1-5]|easy|medium|hard)\]\s+(?P<body>.+?)\s*$",
    re.IGNORECASE,
)
_FAILURE_PHRASES = (
    "race condition", "false positive", "manual ship", "raced autocommit",
    "false-positive", "false flagged", "false-flagged", "regression", "stale",
    "broken", "missed", "dropped", "orphan", "leak",
)
_APPROACH_PHRASES = (
    "synchronously", "fall-through", "sync-fire", "atomic", "shadow-mode",
    "opt-in", "pre-write", "post-tool", "soft-flag", "deny=false",
)
_DECISION_RE = re.compile(
    r"\b(chose|picked|opted|decided|preferred)\s+([A-Za-z_][\w\-./]+)\s+"
    r"(over|vs|instead of|rather than)\s+([A-Za-z_][\w\-./]+)",
    re.IGNORECASE,
)


@dataclass
class Pattern:
    category: str
    description: str
    frequency: int = 1
    last_seen: str = ""
    source_phases: list[str] = field(default_factory=list)


def _walk_devlog() -> list[Path]:
    if not _DEVLOG_DIR.is_dir():
        return []
    return sorted(_DEVLOG_DIR.glob("*-*.md"))


def _section(text: str, header: str) -> str:
    marker = f"## {header}"
    if marker not in text:
        return ""
    after = text.split(marker, 1)[1]
    next_header = re.search(r"\n##\s+", after)
    return after[:next_header.start()] if next_header else after


def _archive_section(text: str, header: str, next_header: str) -> str:
    marker = f"## {header}"
    if marker not in text:
        return ""
    after = text.split(marker, 1)[1]
    stop = f"\n## {next_header}"
    return after.split(stop, 1)[0] if stop in after else after


def _extract_todo_archive(text: str, slug: str) -> list[Pattern]:
    out: list[Pattern] = []
    first = text.splitlines()[0] if text.splitlines() else ""
    if first.startswith("# Devlog -- "):
        set_name = first.replace("# Devlog -- ", "", 1).strip()
        if set_name:
            out.append(Pattern(
                category="archive",
                description=f"archived set: {set_name[:80]}",
                last_seen=slug,
                source_phases=[f"{slug}#TODO"],
            ))
    todo_snapshot = _archive_section(text, "TODO snapshot", "todos.json snapshot")
    if not todo_snapshot:
        return out
    for line in todo_snapshot.splitlines():
        m = _TODO_TASK_RE.match(line)
        if not m:
            continue
        tier = m.group("tier").upper()
        if tier == "EASY":
            tier = "E2"
        elif tier == "MEDIUM":
            tier = "E3"
        elif tier == "HARD":
            tier = "E4"
        body = m.group("body").strip()
        source = f"{slug}#TODO"
        if m.group("mark").lower() == "x":
            out.append(Pattern(
                category="task",
                description=body[:120],
                last_seen=slug,
                source_phases=[source],
            ))
            out.append(Pattern(
                category="task_tier",
                description=f"{tier} completed task",
                last_seen=slug,
                source_phases=[source],
            ))
        for fref in _FILE_REF_RE.finditer(body):
            path = (fref.group(1) or fref.group(2) or "").lstrip("./")
            if path and not path.startswith("../"):
                out.append(Pattern(
                    category="tech_stack",
                    description=path,
                    last_seen=slug,
                    source_phases=[source],
                ))
    return out


def _extract_from_devlog(fp: Path) -> list[Pattern]:
    """Parse one devlog snapshot."""
    out: list[Pattern] = []
    try:
        text = fp.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return out
    slug = fp.stem
    out.extend(_extract_todo_archive(text, slug))
    in_phase: int | None = None
    for line in text.splitlines():
        ph = _PHASE_HEADER_RE.match(line)
        if ph:
            in_phase = int(ph.group(1))
            wp, wc, ws, we = ph.group(3), ph.group(4), ph.group(5), ph.group(6)
            if wp and ws and int(wp) >= 3 and int(ws) >= 3:
                out.append(Pattern(
                    category="architecture",
                    description=f"high-priority+simple Phase: {ph.group(2).strip()[:80]}",
                    last_seen=slug, source_phases=[f"{slug}#P{in_phase}"],
                ))
            continue
        for fref in _FILE_REF_RE.finditer(line):
            path = (fref.group(1) or fref.group(2) or "").lstrip("./")
            if path.startswith("../"):
                continue
            out.append(Pattern(
                category="tech_stack",
                description=path,
                last_seen=slug,
                source_phases=[f"{slug}#P{in_phase or 0}"],
            ))
        ll = line.lower()
        for ph_str in _FAILURE_PHRASES:
            if ph_str in ll:
                out.append(Pattern(
                    category="failure_mode",
                    description=ph_str,
                    last_seen=slug,
                    source_phases=[f"{slug}#P{in_phase or 0}"],
                ))
        for ap in _APPROACH_PHRASES:
            if ap in ll:
                out.append(Pattern(
                    category="approach",
                    description=ap,
                    last_seen=slug,
                    source_phases=[f"{slug}#P{in_phase or 0}"],
                ))
        for m in _DECISION_RE.finditer(line):
            verb, chosen, _conj, rejected = m.groups()
            out.append(Pattern(
                category="decision",
                description=f"{chosen[:30]} over {rejected[:30]}",
                last_seen=slug,
                source_phases=[f"{slug}#P{in_phase or 0}"],
            ))
    return out


def _aggregate(patterns: list[Pattern]) -> list[Pattern]:
    """Combine duplicates by (category, description). Sum frequencies, union sources."""
    bucket: dict[tuple[str, str], Pattern] = {}
    for p in patterns:
        key = (p.category, p.description)
        if key in bucket:
            bucket[key].frequency += 1
            bucket[key].last_seen = p.last_seen
            for sp in p.source_phases:
                if sp not in bucket[key].source_phases:
                    bucket[key].source_phases.append(sp)
        else:
            bucket[key] = Pattern(**asdict(p))
    return sorted(bucket.values(), key=lambda x: -x.frequency)


def _write_learnings(patterns: list[Pattern]) -> int:
    _LEARNINGS.parent.mkdir(parents=True, exist_ok=True)
    with open(_LEARNINGS, "w", encoding="utf-8") as f:
        for p in patterns:
            f.write(json.dumps(asdict(p)) + "\n")
    return len(patterns)


def _read_learnings() -> list[Pattern]:
    if not _LEARNINGS.is_file():
        return []
    out = []
    with open(_LEARNINGS, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(Pattern(**json.loads(line)))
            except (json.JSONDecodeError, TypeError):
                continue
    return out


def cmd_extract() -> int:
    all_patterns: list[Pattern] = []
    for fp in _walk_devlog():
        all_patterns.extend(_extract_from_devlog(fp))
    if not all_patterns:
        print("learnings: no devlog snapshots found")
        return 0
    aggregated = _aggregate(all_patterns)
    n = _write_learnings(aggregated)
    print(f"learnings: extracted {n} unique patterns from {len(_walk_devlog())} devlog snapshot(s) -> {_LEARNINGS}")
    return 0


def cmd_list(top: int) -> int:
    patterns = _read_learnings()
    if not patterns:
        print("learnings: no patterns yet -- run `i/learn learnings extract` first")
        return 0
    by_cat: dict[str, list[Pattern]] = defaultdict(list)
    for p in patterns:
        by_cat[p.category].append(p)
    for cat in sorted(by_cat):
        items = sorted(by_cat[cat], key=lambda x: -x.frequency)[:top]
        print(f"\n{cat} ({len(by_cat[cat])} unique):")
        for p in items:
            print(f"  {p.frequency:>3}x  {p.description[:80]}  [last: {p.last_seen}]")
    return 0


def cmd_surface(keyword: str, top: int) -> int:
    patterns = _read_learnings()
    if not patterns:
        return 0
    matches = [p for p in patterns if keyword.lower() in p.description.lower()]
    matches.sort(key=lambda x: -x.frequency)
    if not matches:
        print(f"learnings: no patterns matching '{keyword}'")
        return 0
    print(f"learnings: {len(matches)} pattern(s) matching '{keyword}' (showing top {top}):")
    for p in matches[:top]:
        print(f"  [{p.category}] {p.frequency}x: {p.description[:80]}  [last: {p.last_seen}]")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("extract", help="walk devlog + extract patterns to KB/learnings.jsonl")
    p_list = sub.add_parser("list", help="show patterns by category, frequency-ranked")
    p_list.add_argument("--top", type=int, default=10)
    p_surface = sub.add_parser("surface", help="patterns matching keyword")
    p_surface.add_argument("--keyword", required=True)
    p_surface.add_argument("--top", type=int, default=5)
    args = parser.parse_args(argv)
    if args.cmd == "extract":
        return cmd_extract()
    if args.cmd == "list":
        return cmd_list(args.top)
    if args.cmd == "surface":
        return cmd_surface(args.keyword, args.top)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
