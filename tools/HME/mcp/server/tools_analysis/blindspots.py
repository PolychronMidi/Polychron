"""HME Evolver blind-spot surfacing — Phase 2.4 of openshell_features_to_mimic.md.

Reads `metrics/hme-activity.jsonl` across a configurable rolling window of
rounds and computes what the Evolver has *systematically avoided*:

  - Subsystems untouched in the last N rounds
  - Modules written without a prior HME read in the last M rounds
  - Modules flagged by KB staleness (MISSING coverage entirely)

Surfaced via `status(mode='blindspots')` so the Evolver can query it during
Phase 1 perception. Intentionally factual ("never touched") rather than
judgmental ("should touch") — the data is coverage, the decision is the
Evolver's.

A "round" is the window between two `round_complete` events. The rolling
window defaults to 10 rounds but honors the HME_BLINDSPOT_WINDOW env var.
"""
from __future__ import annotations

import json
import os
from collections import Counter
from typing import Any

from server import context as ctx
from . import _track
from hme_env import ENV

ACTIVITY_PATH_REL = os.path.join("output", "metrics", "hme-activity.jsonl")
STALENESS_PATH_REL = os.path.join("output", "metrics", "kb-staleness.json")

DEFAULT_WINDOW = ENV.require_int("HME_BLINDSPOT_WINDOW")

SUBSYSTEMS = [
    "utils",
    "conductor",
    "rhythm",
    "time",
    "composers",
    "fx",
    "crossLayer",
    "writer",
    "play",
]


def _load_events() -> list[dict]:
    path = os.path.join(ctx.PROJECT_ROOT, ACTIVITY_PATH_REL)
    if not os.path.exists(path):
        return []
    out: list[dict] = []
    with open(path, encoding="utf-8", errors="ignore") as f:
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
    """Split the event stream into rounds. A round ends at round_complete.
    Trailing events after the last round_complete form an open round."""
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
    """Extract the subsystem name from a file path under src/."""
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
    # Strip file extension if src/*.js
    if "." in first:
        return None
    return first


def _load_staleness_modules() -> dict[str, str]:
    path = os.path.join(ctx.PROJECT_ROOT, STALENESS_PATH_REL)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    out: dict[str, str] = {}
    for m in data.get("modules", []):
        mod = m.get("module")
        status = m.get("status")
        if mod and status:
            out[mod] = status
    return out


def _count_subsystem_files() -> dict[str, int]:
    """Count how many .js files each subsystem contains (full repo total)."""
    counts: dict[str, int] = {sub: 0 for sub in SUBSYSTEMS}
    src_dir = os.path.join(ctx.PROJECT_ROOT, "src")
    for root, _dirs, files in os.walk(src_dir):
        rel = os.path.relpath(root, src_dir)
        if rel == ".":
            continue
        top = rel.split(os.sep, 1)[0]
        if top not in counts:
            continue
        for f in files:
            if f.endswith(".js"):
                counts[top] += 1
    return counts


def blindspots(window: int = 0) -> str:
    """Summarize what the Evolver has structurally avoided over the last N
    rounds. Defaults to N=10 (HME_BLINDSPOT_WINDOW env var)."""
    _track("blindspots")

    if window <= 0:
        window = DEFAULT_WINDOW

    events = _load_events()
    if not events:
        return (
            "# Blind Spot Report\n\n"
            "output/metrics/hme-activity.jsonl is empty. Nothing to analyse — "
            "activity stream must run for at least one round first."
        )

    rounds = _split_into_rounds(events)
    # Consider only closed rounds (each ending in round_complete). Drop the
    # trailing open round because its coverage is still accumulating.
    closed_rounds = [r for r in rounds if r and r[-1].get("event") == "round_complete"]
    window_rounds = closed_rounds[-window:] if closed_rounds else []

    if not window_rounds:
        return (
            "# Blind Spot Report\n\n"
            f"No closed rounds yet in the activity stream ({len(rounds)} open). "
            "Need at least one round_complete event to compute blind spots."
        )

    # Subsystems touched anywhere in the window
    subsystems_touched: Counter = Counter()
    modules_written: Counter = Counter()
    modules_without_prior_read: Counter = Counter()

    for r in window_rounds:
        seen_subsystems: set[str] = set()
        for ev in r:
            if ev.get("event") != "file_written":
                continue
            file_path = ev.get("file") or ""
            sub = _subsystem_for_path(file_path)
            if sub:
                seen_subsystems.add(sub)
            mod = ev.get("module") or ""
            if mod:
                modules_written[mod] += 1
                if ev.get("hme_read_prior") is not True:
                    modules_without_prior_read[mod] += 1
        for sub in seen_subsystems:
            subsystems_touched[sub] += 1

    file_counts = _count_subsystem_files()
    untouched_subsystems = []
    for sub in SUBSYSTEMS:
        rounds_touched = subsystems_touched.get(sub, 0)
        if rounds_touched == 0:
            untouched_subsystems.append((sub, file_counts.get(sub, 0)))

    # Modules never read before write in the window (at least 2 writes)
    chronic_no_read = [
        (m, count)
        for m, count in modules_without_prior_read.most_common(50)
        if count >= 2
    ]

    # KB-missing modules that WERE touched in this window
    staleness_status = _load_staleness_modules()
    kb_missing_touched = []
    for mod, _count in modules_written.most_common():
        if staleness_status.get(mod) == "MISSING":
            kb_missing_touched.append(mod)
    kb_missing_touched = kb_missing_touched[:20]

    lines = [
        "# Blind Spot Report",
        "",
        f"Window: last {len(window_rounds)} closed round(s)  "
        f"(of {len(closed_rounds)} total closed, {len(rounds)} raw)",
        "",
    ]

    lines.append("## Subsystems untouched in window")
    if untouched_subsystems:
        for sub, n_files in untouched_subsystems:
            lines.append(f"  - {sub:<12} ({n_files} file{'s' if n_files != 1 else ''} in repo)")
    else:
        lines.append("  All 9 subsystems touched at least once.")

    lines.append("")
    lines.append("## Modules written chronically without HME read")
    if chronic_no_read:
        for mod, count in chronic_no_read[:15]:
            lines.append(f"  - {mod:<30} {count} write(s) without prior read")
    else:
        lines.append("  None — every repeated write preceded by at least one HME read.")

    lines.append("")
    lines.append("## Touched modules with no KB coverage")
    if kb_missing_touched:
        for mod in kb_missing_touched:
            lines.append(f"  - {mod}")
    else:
        lines.append("  All touched modules have at least one matching KB entry.")

    # Bottom-line coverage ratio
    total_modules_touched = len(modules_written)
    total_rounds = len(window_rounds)
    lines.append("")
    lines.append("## Coverage")
    lines.append(f"  {total_modules_touched} unique module(s) touched in {total_rounds} round(s)")
    lines.append(f"  {sum(modules_written.values())} total file_written event(s)")

    return "\n".join(lines)
