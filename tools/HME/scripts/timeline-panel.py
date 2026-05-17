#!/usr/bin/env python3
"""i/status timeline -- unified audit trail of HME's silent automations.

HME has many invisible side-effects per turn: auto-reload (watcher),
KB draft writes (posttooluse_bash on STABLE/EVOLVED), reindex (fs_watcher
debounce), brief recordings (posttooluse_read_kb), pipeline lock
transitions, NEXUS state advancement. Each leaves a trace SOMEWHERE --
activity log, marker files, state files. This view joins them into one
chronological list so an agent can answer "what has HME done in the last
N minutes?" without reading 5+ files.

Usage:
    i/status timeline              # last 30 events
    i/status timeline window=5m    # last 5 minutes only
    i/status timeline window=1h    # last hour
"""
from __future__ import annotations
import json
import os
import sys
import time
from datetime import datetime

from _common import PROJECT_ROOT


def _parse_window(arg: str) -> float:
    """'5m' -> 300, '1h' -> 3600, '30s' -> 30, default 30m."""
    if not arg:
        return 1800.0
    arg = arg.strip().lower()
    try:
        if arg.endswith("s"):
            return float(arg[:-1])
        if arg.endswith("m"):
            return float(arg[:-1]) * 60
        if arg.endswith("h"):
            return float(arg[:-1]) * 3600
        return float(arg)
    except ValueError:
        return 1800.0


def _human_age(delta: float) -> str:
    if delta < 60:
        return f"{int(delta)}s"
    if delta < 3600:
        return f"{int(delta/60)}m"
    return f"{delta/3600:.1f}h"


def _gather_marker_events(now: float, window_s: float) -> list[dict]:
    """Read tmp/hme-last-*.json marker files; one event per marker still
    in window. Markers track silent automations the activity log doesn't
    necessarily capture (auto-reload, draft-write, accept).

    These are SYNTHESIZED events -- derived from file existence/mtime
    rather than emit() calls into hme-activity.jsonl. So they will NOT
    appear in EVENTS.md (which catalogues real activity events) and the
    activity-events-doc-sync verifier won't see them as drift."""
    out = []
    candidates = [
        ("hme-last-reload.json",          "auto-reload"),
        ("hme-learn-draft.json",          "kb-draft-written"),
        ("hme-learn-draft.json.accepted", "kb-draft-accepted"),
        ("run.lock",                      "pipeline-running"),
    ]
    tmp = os.path.join(PROJECT_ROOT, "tmp")
    for fname, ev_label in candidates:
        path = os.path.join(tmp, fname)
        if not os.path.exists(path):
            continue
        try:
            mt = os.path.getmtime(path)
        except OSError:
            continue
        age = now - mt
        if age > window_s:
            continue
        detail = ""
        # Read marker payload for richer detail when JSON
        if fname.endswith(".json"):
            try:
                with open(path) as f:
                    payload = json.load(f)
                if "trigger" in payload:
                    detail = f"trigger={payload.get('trigger', '?')}"
                elif "title" in payload:
                    detail = f"title={payload.get('title', '?')[:60]}"
            except (OSError, ValueError):
                pass  # silent-ok: best-effort fs op
        out.append({"ts": mt, "event": ev_label, "source": "marker", "detail": detail})
    return out


def _gather_activity_events(now: float, window_s: float) -> list[dict]:
    """Read tail of activity log; events since (now - window_s)."""
    p = os.path.join(PROJECT_ROOT, "src", "output", "metrics", "hme-activity.jsonl")
    if not os.path.isfile(p):
        return []
    try:
        with open(p) as f:
            lines = f.readlines()[-1500:]
    except OSError:
        return []
    cutoff = now - window_s
    out = []
    for ln in lines:
        try:
            e = json.loads(ln)
        except ValueError:
            continue
        ts = e.get("ts", 0)
        if ts < cutoff:
            continue
        out.append({
            "ts": ts,
            "event": e.get("event", "?"),
            "source": e.get("source", e.get("session", "?")),
            "detail": "",
        })
    return out


def main(argv):
    window = ""
    for a in argv[1:]:
        if a.startswith("window="):
            window = a.split("=", 1)[1]
    window_s = _parse_window(window)
    now = time.time()

    events = _gather_marker_events(now, window_s) + _gather_activity_events(now, window_s)
    events.sort(key=lambda e: e.get("ts", 0))

    # Run-length collapse: merge consecutive same (event, source) entries.
    collapsed = []
    last_key = None
    last_ts = 0.0
    count = 0
    last_detail = ""
    def _flush():
        if last_key is None:
            return
        ev, src = last_key
        prefix = f"{count}* " if count > 1 else ""
        det = f"  ({last_detail})" if last_detail else ""
        collapsed.append((last_ts, f"  {prefix}{ev:24}  {src}{det}"))
    for e in events:
        key = (e["event"], e["source"])
        if key == last_key:
            count += 1
            last_ts = e["ts"]
        else:
            _flush()
            last_key = key
            last_ts = e["ts"]
            last_detail = e.get("detail", "")
            count = 1
    _flush()

    out = [f"# HME timeline (window={window_s/60:.0f}m, {len(events)} raw events -> {len(collapsed)} grouped)"]
    out.append("")
    if not collapsed:
        out.append("  (no automations or activity in this window)")
    else:
        for ts, label in collapsed[-30:]:
            age = _human_age(now - ts)
            time_str = datetime.fromtimestamp(ts).strftime("%H:%M:%S")
            out.append(f"  {time_str} ({age:>5} ago)  {label.lstrip()}")
    out.append("")
    out.append("# When in doubt:")
    out.append("  i/status timeline window=5m       narrow to last 5 minutes")
    out.append("  i/status timeline window=1h       widen to last hour")
    out.append("  i/status state                    snapshot of current state machines")
    out.append("  i/why mode=hook            recent hook firings only (narrower scope)")
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv) or 0)
