"""Mode handlers -- extracted from mode_handlers.py.
mode_handlers.py imports back and registers in _STATUS_MODES.
"""
from __future__ import annotations

import json
import logging
import os

from server import context as ctx
from .. import (
    _track, get_session_intent, _budget_gate, _budget_section, _git_run,
    BUDGET_COMPOUND, BUDGET_TOOL, BUDGET_SECTION,
)
from ..synthesis_session import (
    append_session_narrative, get_session_narrative, get_think_history_context,
)
from .event_groups import activity_event_names

logger = logging.getLogger("HME")


def _mode_learn_suggestions():
    """Surface registry-classified learn-suggestion events.

    Shows, per module: file path, module name, session, timestamp (latest
    first). Up to 20 entries from the last round. Agent can drive a
    `learn()` pass to capture the novel findings those edits represent.
    """
    import os as _os
    import json as _json
    from server import context as _ctx
    activity_path = _os.path.join(
        _os.environ.get("METRICS_DIR") or _os.path.join(_ctx.PROJECT_ROOT, "output", "metrics"),
        "hme-activity.jsonl",
    )
    if not _os.path.isfile(activity_path):
        return "## Learn Suggestions\n  (no activity log yet)"
    try:
        size = _os.path.getsize(activity_path)
        read_from = max(0, size - 256 * 1024)
        with open(activity_path, "rb") as f:
            if read_from:
                f.seek(read_from)
                f.readline()
            text = f.read().decode("utf-8", errors="replace")
    except OSError as _err:
        return f"## Learn Suggestions\n  (activity log unreadable: {_err})"
    events: list[dict] = []
    last_round_idx = -1
    all_lines = text.splitlines()
    round_names = activity_event_names("round_boundary")
    suggestion_names = activity_event_names("learn_suggestion")
    for i, line in enumerate(all_lines):
        if not line.strip():
            continue
        try:
            ev = _json.loads(line)
        except _json.JSONDecodeError:
            continue
        if ev.get("event") in round_names:
            last_round_idx = i
        if ev.get("event") in suggestion_names:
            events.append(ev)
    if not events:
        return "## Learn Suggestions\n  No learn-suggestion events this round."
    # Dedup by (file, module); keep most recent timestamp per key.
    def _ts(ev: dict) -> float:
        t = ev.get("ts")
        return t if isinstance(t, (int, float)) else 0.0
    latest: dict[tuple, dict] = {}
    for ev in events:
        key = (ev.get("file", ""), ev.get("module", ""))
        if key in latest and _ts(latest[key]) >= _ts(ev):
            continue
        latest[key] = ev
    rows = sorted(latest.values(), key=_ts, reverse=True)[:20]
    lines = [
        "## Learn Suggestions",
        f"  {len(rows)} module(s) edited with MISSING KB coverage this round. "
        f"Each is a candidate for `learn()` to capture what those edits encode.",
        "",
    ]
    for ev in rows:
        mod = ev.get("module", "?")
        f = ev.get("file", "?")
        lines.append(f"  - {mod}  ({f})")
    lines.append("")
    lines.append("  Capture with: `learn(title='<concise>', content='<2-3 sentences>', category='architecture|pattern|decision')`")
    return "\n".join(lines)
