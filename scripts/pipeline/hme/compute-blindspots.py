#!/usr/bin/env python3
"""Compute blindspots JSON — structured output for propose-next-actions.

The blindspots logic already exists in tools_analysis/blindspots.py but
emits markdown for the status tool. This script computes the same data
and writes JSON at output/metrics/hme-blindspots.json so the action
proposer (and any other consumer) has structured input.

Schema (matches propose-next-actions.py's reader):
  {
    "generated_at": <epoch>,
    "window_rounds": <int>,
    "dark_subsystems":      [{"subsystem": <str>, "files_in_repo": <int>, "rounds_without_writes": <int>}],
    "chronic_unread_modules": [{"module": <str>, "write_count": <int>}],
    "uncovered_modules":    [<module-name>, ...]
  }
"""
from __future__ import annotations
import json
import os
import sys
import time
from collections import Counter
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", Path(__file__).resolve().parent.parent.parent.parent))
ACTIVITY = PROJECT_ROOT / "output" / "metrics" / "hme-activity.jsonl"
STALENESS = PROJECT_ROOT / "output" / "metrics" / "kb-staleness.json"
OUT = PROJECT_ROOT / "output" / "metrics" / "hme-blindspots.json"
WINDOW = int(os.environ.get("HME_BLINDSPOT_WINDOW", "10"))

SUBSYSTEMS = ["utils", "conductor", "rhythm", "time", "composers",
              "fx", "crossLayer", "writer", "play"]


def _load_events() -> list[dict]:
    if not ACTIVITY.is_file():
        return []
    out: list[dict] = []
    with open(ACTIVITY, encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def _split_into_rounds(events: list[dict]) -> list[list[dict]]:
    rounds: list[list[dict]] = []
    current: list[dict] = []
    for ev in events:
        current.append(ev)
        if ev.get("event") == "round_complete":
            rounds.append(current)
            current = []
    if current:
        rounds.append(current)
    return rounds


def _subsystem_for_path(path: str) -> str | None:
    if not path:
        return None
    parts = path.split("/")
    try:
        idx = parts.index("src")
    except ValueError:
        return None
    if idx + 1 >= len(parts):
        return None
    first = parts[idx + 1]
    if "." in first:
        return None
    return first


def _count_subsystem_files() -> dict[str, int]:
    counts: dict[str, int] = {s: 0 for s in SUBSYSTEMS}
    src = PROJECT_ROOT / "src"
    for root, _, files in os.walk(src):
        rel = os.path.relpath(root, src)
        if rel == ".":
            continue
        top = rel.split(os.sep, 1)[0]
        if top in counts:
            for f in files:
                if f.endswith(".js"):
                    counts[top] += 1
    return counts


def _load_staleness() -> dict[str, str]:
    if not STALENESS.is_file():
        return {}
    try:
        data = json.loads(STALENESS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    out: dict[str, str] = {}
    for m in data.get("modules", []):
        mod = m.get("module")
        status = m.get("status")
        if mod and status:
            out[mod] = status
    return out


def main() -> int:
    events = _load_events()
    rounds = _split_into_rounds(events)
    closed = [r for r in rounds if r and r[-1].get("event") == "round_complete"]
    window_rounds = closed[-WINDOW:] if closed else []

    subsystems_touched: Counter = Counter()
    modules_written: Counter = Counter()
    modules_without_prior_read: Counter = Counter()

    for r in window_rounds:
        seen: set[str] = set()
        for ev in r:
            if ev.get("event") != "file_written":
                continue
            file_path = ev.get("file") or ""
            sub = _subsystem_for_path(file_path)
            if sub:
                seen.add(sub)
            mod = ev.get("module") or ""
            if mod:
                modules_written[mod] += 1
                if ev.get("hme_read_prior") is not True:
                    modules_without_prior_read[mod] += 1
        for s in seen:
            subsystems_touched[s] += 1

    file_counts = _count_subsystem_files()
    dark_subsystems = [
        {
            "subsystem": sub,
            "files_in_repo": file_counts.get(sub, 0),
            "rounds_without_writes": len(window_rounds),
        }
        for sub in SUBSYSTEMS
        if subsystems_touched.get(sub, 0) == 0 and file_counts.get(sub, 0) > 0
    ]

    chronic_unread = [
        {"module": m, "write_count": c}
        for m, c in modules_without_prior_read.most_common(50)
        if c >= 2
    ]

    staleness = _load_staleness()
    uncovered_modules = [
        mod for mod in modules_written
        if staleness.get(mod) == "MISSING"
    ][:20]

    out = {
        "generated_at": int(time.time()),
        "window_rounds": len(window_rounds),
        "total_closed_rounds": len(closed),
        "dark_subsystems": dark_subsystems,
        "chronic_unread_modules": chronic_unread,
        "uncovered_modules": uncovered_modules,
        "coverage": {
            "unique_modules_touched": len(modules_written),
            "total_file_writes": int(sum(modules_written.values())),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
    print(f"compute-blindspots: {len(dark_subsystems)} dark subsystem(s), "
          f"{len(chronic_unread)} chronic unread, {len(uncovered_modules)} uncovered "
          f"(window={len(window_rounds)} rounds)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
