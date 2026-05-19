"""HME activity digest -- reads metrics/hme-activity.jsonl and summarizes it.

Exposes a single reader `activity_digest(window="round")` that surfaces:
  - event counts by type (file_written, edit_pending, pipeline_run, ...)
  - coherence violations (writes without a prior HME read call in the same session)
  - round boundaries (last pipeline_run / round_complete)
  - recent files touched with their hme_read_prior flag

Consumed by status_unified.status(mode="activity") -- does not register as a
top-level MCP tool to preserve the 6-tool public surface.
"""
from __future__ import annotations

import json
import logging
import os
from collections import Counter, defaultdict

ROUTINE_EVENTS = {
    "inference_call",
    "tool_call",
    "turn_complete",
    "cache_control_normalized",
    "brief_recorded",
    "enricher_fired",
    "enricher_acted_upon",
    "dir_context",
    "read_context",
    "boilerplate_stripped",
    "semantic_redundancy_stripped",
    "skill_reminder_stripped",
    "cascade_prediction_empty",
}

from server import context as ctx
from paths import hme_metric
from . import _track

logger = logging.getLogger("HME")

ACTIVITY_PATH_REL = hme_metric("hme-activity.jsonl")
DEFAULT_LOOKBACK_LINES = 500


def _load_events(lookback: int = DEFAULT_LOOKBACK_LINES) -> list[dict]:
    path = os.path.join(ctx.PROJECT_ROOT, ACTIVITY_PATH_REL)
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
    tail = lines[-lookback:] if lookback > 0 else lines
    events = []
    for line in tail:
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def _fmt_ts(ts: int | None) -> str:
    if not ts:
        return "?"
    import datetime as _dt
    return _dt.datetime.fromtimestamp(ts).strftime("%H:%M:%S")


def activity_digest(window: str = "round", verbose: bool = False) -> str:
    """Summarize hme-activity.jsonl for the current session/round.

    window:
      'round'   -- events since the last round_complete (or full tail if none)
      'session' -- events since the last session start (falls back to last 500 lines)
      'all'     -- full tail (last 500 lines)
    """
    _track("activity_digest")

    events = _load_events()
    if not events:
        return (
            "# Activity Digest\n\n"
            "No events recorded yet. metrics/hme-activity.jsonl is empty or missing.\n"
            "Hooks begin emitting events on the next Edit/Bash/Stop cycle."
        )

    # Slice by window
    if window == "round":
        last_round_idx = None
        for i in range(len(events) - 1, -1, -1):
            if events[i].get("event") == "round_complete":
                last_round_idx = i
                break
        if last_round_idx is not None:
            # Always slice when a boundary was found, even if round_complete
            events = events[last_round_idx + 1 :]

    first_ts = events[0].get("ts")
    last_ts = events[-1].get("ts")

    if verbose:
        display_events = events
    else:
        display_events = [
            e for e in events
            if not (
                e.get("event") == "coherence_violation"
                and e.get("verdict") == "STALE"
                and not e.get("reason")
            )
        ]
    counts: Counter = Counter(e.get("event", "?") for e in display_events)

    # Coherence violations
    violations = [e for e in display_events if e.get("event") == "coherence_violation"]

    # Pipeline runs in window
    pipelines = [e for e in events if e.get("event") == "pipeline_run"]

    # Recent file touches (last 10)
    recent_files = []
    for e in events[-30:]:
        if e.get("event") == "file_written" and e.get("file"):
            recent_files.append(e)
    recent_files = recent_files[-10:]

    routine_total = sum(n for evt, n in counts.items() if evt in ROUTINE_EVENTS)
    visible_counts = counts if verbose else Counter({
        evt: n for evt, n in counts.items() if evt not in ROUTINE_EVENTS
    })

    lines = [
        "# Activity Digest",
        "",
        f"Window:     {window}   Events: {len(events)}   "
        f"Span: {_fmt_ts(first_ts)} -> {_fmt_ts(last_ts)}",
        "",
        "## Event counts",
    ]
    if routine_total and not verbose:
        lines.append(f"  routine_compacted      {routine_total}  (use verbose=true for full counts)")
    for evt, n in visible_counts.most_common():
        lines.append(f"  {evt:<22} {n}")

    lines.append("")
    lines.append("## Coherence")

    if violations:
        lines.append("")
        lines.append(f"## Violations ({len(violations)})")
        for v in violations[-5:]:
            lines.append(
                f"  {_fmt_ts(v.get('ts'))}  {v.get('file', '?')}  -- {v.get('reason', '?')}"
            )

    if pipelines:
        lines.append("")
        lines.append("## Pipeline runs")
        for p in pipelines[-5:]:
            verdict = p.get("verdict", "?")
            wall = p.get("wall_s", "?")
            hci = p.get("hci", "?")
            lines.append(f"  {_fmt_ts(p.get('ts'))}  {verdict}  wall={wall}s  hci={hci}")

    if recent_files:
        lines.append("")
        lines.append("## Recent writes")
        for w in recent_files:
            flag = "[ok]" if w.get("hme_read_prior") is True else "[no]"
            rel = w.get("file", "?")
            # Trim long paths to the last 3 segments for compactness
            parts = rel.split("/")
            if len(parts) > 4:
                rel = ".../" + "/".join(parts[-3:])
            lines.append(f"  {_fmt_ts(w.get('ts'))} {flag} {rel}")

    return "\n".join(lines)
