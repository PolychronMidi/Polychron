"""Mode handlers -- extracted from mode_handlers.py.
mode_handlers.py imports back and registers in _STATUS_MODES.
"""
from __future__ import annotations

import json
import logging
import os

from server import context as ctx
from paths import hme_metric
from time_utils import activity_ts_seconds
from .. import (
    _track, get_session_intent, _budget_gate, _budget_section, _git_run,
    BUDGET_COMPOUND, BUDGET_TOOL, BUDGET_SECTION,
)
from ..synthesis_session import (
    append_session_narrative, get_session_narrative, get_think_history_context,
)
from .event_groups import activity_event_names

logger = logging.getLogger("HME")


def _mode_activity():
    from ..activity_digest import activity_digest as _ad
    return _ad(window="round", verbose=False)


def _mode_activity_full():
    from ..activity_digest import activity_digest as _ad
    return _ad(window="round", verbose=True)


def _mode_tool_latency():
    """Horizon I expansion -- tool-cost preflighting.

    Computes per-tool latency from registry-classified tool and inference
    events. Pairs with `i/why mode=predict <file>` for cost/change context.  # tool-form-ok
    """
    import os as _os
    import json as _json
    import time as _time
    from collections import defaultdict
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", "") or "."
    activity = hme_metric("hme-activity.jsonl")
    if not _os.path.isfile(activity):
        return "# i/status mode=tool-latency\nNo activity log."
    try:
        with open(activity) as _f:
            lines = _f.readlines()[-3000:]
    except OSError as e:
        return f"# i/status mode=tool-latency\nFailed to read: {e}"

    cutoff = _time.time() - 3600 * 6  # last 6h
    tool_names = activity_event_names("agent_loop_tool")
    inference_names = activity_event_names("inference")
    by_tool: dict[str, list[float]] = defaultdict(list)
    inf_ts: list[float] = []
    for ln in lines:
        try:
            e = _json.loads(ln)
        except ValueError:
            continue
        ts = activity_ts_seconds(e.get("ts"))
        if ts is None or ts < cutoff:
            continue
        e["ts"] = ts
        ev = e.get("event", "")
        if ev in tool_names:
            tool = e.get("tool", "?")
            # latency_ms isn't always present; if it is, use it
            if "latency_ms" in e:
                by_tool[tool].append(float(e["latency_ms"]))
        elif ev in inference_names:
            inf_ts.append(ts)

    out = ["# Tool-cost preflighting  (last 6h)"]
    out.append("")
    if by_tool:
        out.append(f"  {'tool':18}  {'n':>4}  {'p50':>7}  {'p95':>7}  {'p99':>7}  ms  cold-start?")
        for tool, latencies in sorted(by_tool.items(), key=lambda kv: -len(kv[1])):
            if len(latencies) < 3:
                continue
            s = sorted(latencies)
            p50 = s[len(s) // 2]
            p95 = s[int(len(s) * 0.95)]
            p99 = s[int(len(s) * 0.99)]
            # Cold-start indicator (Horizon I asymptote): if max >= 3* p50,
            cold = "yes" if (s[-1] >= p50 * 3 and len(s) >= 5) else " no"
            sample_caveat = " (n<10; noisy)" if len(s) < 10 else ""
            out.append(f"  {tool:18}  {len(s):>4}  {p50:>7.0f}  {p95:>7.0f}  {p99:>7.0f}  ms  {cold}{sample_caveat}")
        out.append("")
    else:
        out.append("  (no generic tool-call events in window -- falling back to inference cadence)")
        last_tool_call_ts = None
        try:
            full_path = hme_metric("hme-activity.jsonl")
            with open(full_path) as _af:
                for ln in _af:
                    try:
                        e = _json.loads(ln)
                    except ValueError:
                        continue
                    if e.get("event") in tool_names:
                        ts = e.get("ts", 0)
                        if isinstance(ts, (int, float)) and (last_tool_call_ts is None or ts > last_tool_call_ts):
                            last_tool_call_ts = ts
        except OSError:
            pass  # silent-ok: best-effort fs op
        if last_tool_call_ts:
            from datetime import datetime as _dt
            age_s = _time.time() - last_tool_call_ts
            if age_s < 86400:
                age_str = f"{int(age_s/3600)}h ago"
            elif age_s < 86400 * 7:
                age_str = f"{int(age_s/86400)}d ago"
            else:
                age_str = f"{int(age_s/86400)}d ago"
            ts_iso = _dt.fromtimestamp(last_tool_call_ts).strftime("%Y-%m-%d %H:%M")
            out.append(f"  last generic tool-call: {ts_iso} ({age_str})")
        else:
            out.append("  last generic tool-call: NONE in entire log")
        out.append("")
        out.append("  Root-cause hypothesis: proxy daemon not routing tool_use/tool_result")
        out.append("  pairs through the middleware pipeline. activity_log.js loads cleanly")
        out.append("  in isolation; the regression is at dispatch-call level.")
        out.append("  Remediation: check proxy daemon status; review hme_proxy.js routing.")
        out.append("")

    # Inference-cadence proxy: how spaced apart are calls?
    if len(inf_ts) >= 5:
        inf_ts.sort()
        gaps = [inf_ts[i + 1] - inf_ts[i] for i in range(len(inf_ts) - 1)]
        gaps.sort()
        median_gap = gaps[len(gaps) // 2]
        p95_gap = gaps[int(len(gaps) * 0.95)]
        out.append(f"  inference-call cadence (proxy for round-trip cost):")
        out.append(f"    {len(inf_ts)} calls . median gap {median_gap:.1f}s . p95 {p95_gap:.1f}s")
        out.append("")

    out.append("# Reading the table:")
    out.append("  - Use to estimate the cost of an upcoming call BEFORE making it.")
    out.append("  - High p99 = occasionally slow; high p50 = always slow.")
    out.append("  - Pairs with `i/why mode=predict <file>` for cost AND change predictions.")  # tool-form-ok: drill-in advisory; literal command shape is the contract
    return "\n".join(out)




def _mode_agent_loop():
    """Horizon IV -- agent behavior as a tracked dimension.

    The agent (the LLM running the session) has been invisible to HME
    except as a stream of tool calls. This mode aggregates per-session
    metrics from registry-classified activity events."""
    import os as _os
    import json as _json
    import time as _time
    from collections import Counter, defaultdict
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", "") or "."
    activity = hme_metric("hme-activity.jsonl")
    if not _os.path.isfile(activity):
        return "# i/status mode=agent-loop\nNo activity log found."
    try:
        with open(activity) as _f:
            tail = _f.readlines()[-3000:]
    except OSError as e:
        return f"# i/status mode=agent-loop\nFailed to read activity: {e}"

    cutoff = _time.time() - 3600  # last hour
    events = []
    for ln in tail:
        try:
            e = _json.loads(ln)
        except ValueError:
            continue
        ts = activity_ts_seconds(e.get("ts"))
        if ts is not None and ts >= cutoff:
            e["ts"] = ts
            events.append(e)
    if not events:
        return "# i/status mode=agent-loop\nNo activity in last hour."

    loop_names = activity_event_names("agent_loop")
    turn_names = activity_event_names("turn_marker")
    tool_names = activity_event_names("agent_loop_tool")
    inference_names = activity_event_names("inference")
    manual_brief_names = activity_event_names("manual_brief")
    auto_brief_names = activity_event_names("auto_brief")
    error_names = activity_event_names("error_surface")
    loop_events = [e for e in events if e.get("event") in loop_names]
    if not loop_events:
        return (
            "# i/status mode=agent-loop\n"
            f"No agent-loop telemetry in last hour ({len(events)} non-loop activity events)."
        )

    # Per-session windows
    per_session: dict[str, list[dict]] = defaultdict(list)
    for e in loop_events:
        sid = e.get("session", "?")
        per_session[sid].append(e)

    # Aggregate
    by_event: Counter = Counter()
    for e in loop_events:
        by_event[e.get("event", "?")] += 1

    tool_calls = sum(by_event.get(name, 0) for name in tool_names)
    inference_calls = sum(by_event.get(name, 0) for name in inference_names)
    turns = sum(by_event.get(name, 0) for name in turn_names)
    edits = sum(1 for e in loop_events if e.get("event") in tool_names
                and e.get("tool") == "Edit")
    brief_inj = sum(1 for e in loop_events if e.get("event") in auto_brief_names)
    brief_rec = sum(1 for e in loop_events if e.get("event") in manual_brief_names)
    bash_errs = sum(by_event.get(name, 0) for name in error_names)

    out = [f"# Agent loop (last hour, {len(loop_events)} loop events, {len(per_session)} session(s))"]
    out.append("")
    out.append(f"  turns observed:        {turns}")
    if turns > 0:
        out.append(f"  inferences per turn:   {inference_calls/turns:.1f}  (Anthropic API calls per turn)")
    if tool_calls > 0:
        if turns > 0:
            out.append(f"  tools per turn:        {tool_calls/turns:.1f}  (avg)")
        out.append(f"  total tool calls:      {tool_calls}")
        out.append(f"    of which Edit:       {edits}")
        if edits > 0:
            out.append(f"    brief coverage:      {(brief_rec / edits) * 100:.0f}%  ({brief_rec}/{edits})")
        err_rate = bash_errs / tool_calls * 100
        out.append(f"  bash error rate:       {err_rate:.1f}%  ({bash_errs}/{tool_calls})")
    else:
        out.append(f"  total tool calls:      -  (generic tool-call instrumentation degraded; see note)")
        out.append(f"  briefs recorded:       {brief_rec}  (KB briefings)")
    out.append(f"  auto-brief injected:   {brief_inj}")

    # Inter-tool gap across generic tool-call events.
    tool_ts = sorted(e.get("ts", 0) for e in events
                     if e.get("event") in tool_names)
    if len(tool_ts) >= 2:
        gaps = [tool_ts[i + 1] - tool_ts[i] for i in range(len(tool_ts) - 1)]
        gaps.sort()
        median = gaps[len(gaps) // 2]
        p90 = gaps[int(len(gaps) * 0.9)] if len(gaps) >= 10 else gaps[-1]
        out.append(f"  inter-tool gap:        median {median:.1f}s . p90 {p90:.1f}s")

    out.append("")
    out.append("# Loop quality signals:")
    out.append(f"  hook interventions:    {brief_inj + brief_rec} brief-related, {bash_errs} error-surfaced")

    out.append("")
    out.append("# Drill-in:")
    out.append("  i/status timeline window=1h    full chronological view")
    out.append("  i/why mode=hook                broader hook-firing detail")
    return "\n".join(out)
