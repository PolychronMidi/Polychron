"""HME Evolver cognitive load modeling — Phase 5.4.

The previous phases gave HME models of the system and of itself. This
module gives HME a model of the *agent* running the loop. Reads the
activity bridge and computes load signatures per closed round:

  - total_tool_calls      file_written + edit_pending + all others
  - total_file_writes     just file_written events
  - abandonment_rate      (from intention-gap if available)
  - writes_per_round      normalized by wall time if timestamps allow
  - reads_before_abandon  average HME reads preceding an abandoned todo

These are tracked across a rolling window of closed rounds. The proxy
can then query the current session's trajectory against historical
abandonment-associated distributions and inject a preemptive warning
when the session is drifting toward an "abandonment signature".

v1 scope (per the doc's guidance to keep the first version simple):
  - Only 3 signatures: tool_calls, file_writes, abandoned_todos
  - Percentile-based thresholds, not absolute values
  - A single aggregate "load level" LOW / MEDIUM / HIGH

Output: metrics/hme-cognitive-load.json. Surfaced via
status(mode='cognitive_load').
"""
from __future__ import annotations

import json
import os
import time
from collections import defaultdict

from server import context as ctx
from . import _track

ACTIVITY_REL = os.path.join("output", "metrics", "hme-activity.jsonl")
GAP_REL = os.path.join("output", "metrics", "hme-intention-gap.json")
OUT_REL = os.path.join("output", "metrics", "hme-cognitive-load.json")


def _load(rel: str):
    path = os.path.join(ctx.PROJECT_ROOT, rel)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _read_events() -> list[dict]:
    path = os.path.join(ctx.PROJECT_ROOT, ACTIVITY_REL)
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


def _round_signatures(round_events: list[dict]) -> dict:
    tool_calls = 0
    file_writes = 0
    edit_pendings = 0
    for ev in round_events:
        e = ev.get("event")
        if e == "file_written":
            file_writes += 1
            tool_calls += 1
        elif e == "edit_pending":
            edit_pendings += 1
            tool_calls += 1
        elif e and e != "round_complete":
            tool_calls += 1
    return {
        "tool_calls": tool_calls,
        "file_writes": file_writes,
        "edit_pendings": edit_pendings,
    }


def _percentiles(values: list[float]) -> dict[str, float]:
    """Return simple distributional stats. Linear interpolation."""
    if not values:
        return {"p25": 0, "p50": 0, "p75": 0, "p90": 0, "min": 0, "max": 0}
    sorted_vals = sorted(values)

    def q(p: float) -> float:
        idx = (len(sorted_vals) - 1) * p
        lo = int(idx)
        hi = min(lo + 1, len(sorted_vals) - 1)
        frac = idx - lo
        return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * frac

    return {
        "p25": round(q(0.25), 2),
        "p50": round(q(0.5), 2),
        "p75": round(q(0.75), 2),
        "p90": round(q(0.9), 2),
        "min": sorted_vals[0],
        "max": sorted_vals[-1],
    }


def compute_load() -> dict:
    _track("cognitive_load")
    events = _read_events()
    rounds = _split_into_rounds(events)

    closed = [r for r in rounds if r and r[-1].get("event") == "round_complete"]
    sigs_history = [_round_signatures(r) for r in closed]

    # Current (open) round signature — the one we're in right now
    open_round = rounds[-1] if rounds and rounds[-1][-1].get("event") != "round_complete" else []
    current_sig = _round_signatures(open_round) if open_round else {
        "tool_calls": 0,
        "file_writes": 0,
        "edit_pendings": 0,
    }

    # Gap data for abandonment context
    gap = _load(GAP_REL) or {}
    gap_history = gap.get("history") or []

    tool_call_stats = _percentiles([s["tool_calls"] for s in sigs_history])
    file_write_stats = _percentiles([s["file_writes"] for s in sigs_history])
    abandoned_stats = _percentiles(
        [r.get("abandoned", 0) for r in gap_history if isinstance(r, dict)]
    )

    # Classify current session's load level by comparing to history p75
    # Need at least 5 closed rounds for a meaningful percentile
    if len(sigs_history) < 5:
        level = "INSUFFICIENT_DATA"
        reason = f"need ≥5 closed rounds, have {len(sigs_history)}"
        percent = None
    else:
        above_tool_p75 = current_sig["tool_calls"] > tool_call_stats["p75"]
        above_write_p75 = current_sig["file_writes"] > file_write_stats["p75"]
        above_tool_p90 = current_sig["tool_calls"] > tool_call_stats["p90"]
        if above_tool_p90:
            level = "HIGH"
            reason = (
                f"tool_calls={current_sig['tool_calls']} exceeds p90={tool_call_stats['p90']} "
                f"— session is in the top decile of historical workloads"
            )
        elif above_tool_p75 and above_write_p75:
            level = "MEDIUM_HIGH"
            reason = (
                f"tool_calls and file_writes both above p75 "
                f"(tool={current_sig['tool_calls']}>{tool_call_stats['p75']}, "
                f"writes={current_sig['file_writes']}>{file_write_stats['p75']})"
            )
        elif current_sig["tool_calls"] > tool_call_stats["p50"]:
            level = "MEDIUM"
            reason = f"tool_calls={current_sig['tool_calls']} above median ({tool_call_stats['p50']})"
        else:
            level = "LOW"
            reason = "current load below historical median"
        percent = round(
            100 * current_sig["tool_calls"] / max(tool_call_stats["p90"], 1),
            1,
        )

    report = {
        "meta": {
            "script": "cognitive_load.py",
            "timestamp": int(time.time()),
            "closed_rounds_observed": len(sigs_history),
            "current_session_events": sum(current_sig.values()),
        },
        "current_signature": current_sig,
        "history_distribution": {
            "tool_calls": tool_call_stats,
            "file_writes": file_write_stats,
            "abandoned_todos_per_round": abandoned_stats,
        },
        "load_level": level,
        "load_reason": reason,
        "load_percent_of_p90": percent,
    }

    out_path = os.path.join(ctx.PROJECT_ROOT, OUT_REL)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    return report


def cognitive_load_report() -> str:
    _track("cognitive_load_report")
    report = compute_load()
    lines = [
        "# HME Cognitive Load",
        "",
        f"**Load level:** {report['load_level']}",
        f"{report['load_reason']}",
        "",
        f"Closed rounds observed: {report['meta']['closed_rounds_observed']}",
        f"Current session events: {report['meta']['current_session_events']}",
        "",
        "## Current session signature",
    ]
    for k, v in report["current_signature"].items():
        lines.append(f"  {k:<15} {v}")
    lines.append("")
    lines.append("## Historical distribution (closed rounds)")
    for key, dist in report["history_distribution"].items():
        lines.append(f"  {key}")
        lines.append(
            f"    min={dist['min']}  p25={dist['p25']}  p50={dist['p50']}  "
            f"p75={dist['p75']}  p90={dist['p90']}  max={dist['max']}"
        )
    if isinstance(report["load_percent_of_p90"], (int, float)):
        lines.append("")
        lines.append(f"Current tool_calls = {report['load_percent_of_p90']}% of p90")
    return "\n".join(lines)
