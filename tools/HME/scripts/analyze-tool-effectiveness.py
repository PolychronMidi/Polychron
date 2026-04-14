#!/usr/bin/env python3
"""Tool Effectiveness Analyzer — co-occurrence and session-level stats from hme.log.

Parses log/hme.log for:
  - Session boundaries (HME session=...)
  - HME tool call events (RESP <name> [time])
  - Hook fire events (INFO hook: <name>)
  - LIFESAVER critical errors
  - Meta-observer coherence trends

Computes:
  - Per-tool call frequency and median latency
  - Session count + avg session length + tool calls per session
  - Tool pair co-occurrence (pairs of HME tools called within the same session)
  - Hook fire frequency (which hooks actually fire)
  - Dead hook detection (hooks registered but never seen in log)
  - Error rate trends (LIFESAVER fires per session)

Writes metrics/hme-tool-effectiveness.json with the full analysis. Feeds
into the HCI engine via a new ToolEffectivenessVerifier that flags dead
hooks. Used by the onboarding chain to bias tool suggestions toward the
tools that actually fire.

This is the empirical layer: not what SHOULD be effective, but what IS.

Usage:
    python3 tools/HME/scripts/analyze-tool-effectiveness.py
    python3 tools/HME/scripts/analyze-tool-effectiveness.py --stdout
    python3 tools/HME/scripts/analyze-tool-effectiveness.py --summary
"""
import json
import os
import re
import sys
import time
from collections import defaultdict

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_LOG_FILE = os.path.join(_PROJECT, "log", "hme.log")
_HOOKS_JSON = os.path.join(_PROJECT, "tools", "HME", "hooks", "hooks.json")
_OUTPUT = os.path.join(_PROJECT, "metrics", "hme-tool-effectiveness.json")

_SESSION_PAT = re.compile(r"INFO HME session=(\w+)")
_RESP_PAT = re.compile(r"RESP (\w+) \[([0-9.]+)s\]")
_HOOK_PAT = re.compile(r"INFO hook: (\w+)")
_TOOL_PAT = re.compile(r"INFO tool: (\w+)")
_LIFESAVER_PAT = re.compile(r"LIFESAVER QUEUED")
_COHERENCE_PAT = re.compile(r"Meta-observer L14: (\w+)")

# Recency window for scoring: events older than this don't count toward the
# health signal. 24 hours is a reasonable "what happened today" baseline —
# forgotten events from last week shouldn't punish the current HCI forever.
_RECENT_WINDOW_S = 86400  # 24 hours


def _parse_log() -> dict:
    if not os.path.isfile(_LOG_FILE):
        return {"_error": "no log file", "sessions": [], "events": []}

    sessions: list = []
    current_session: dict | None = None
    lifesaver_events = 0
    coherence_events: dict = defaultdict(int)
    recent_coherence_events: dict = defaultdict(int)
    recent_lifesaver_events = 0
    total_lines = 0
    global_tool_invocations: dict = defaultdict(int)
    recent_cutoff = time.time() - _RECENT_WINDOW_S

    try:
        with open(_LOG_FILE, encoding="utf-8", errors="replace") as f:
            for line in f:
                total_lines += 1
                m = _SESSION_PAT.search(line)
                if m:
                    if current_session:
                        sessions.append(current_session)
                    current_session = {
                        "session_id": m.group(1),
                        "started_at": _extract_ts(line),
                        "tool_calls": [],
                        "hook_fires": defaultdict(int),
                        "tool_invocations": defaultdict(int),
                        "lifesaver_count": 0,
                    }
                    continue
                if current_session is None:
                    continue
                m = _RESP_PAT.search(line)
                if m:
                    current_session["tool_calls"].append({
                        "tool": m.group(1),
                        "latency_s": float(m.group(2)),
                        "ts": _extract_ts(line),
                    })
                    continue
                m = _HOOK_PAT.search(line)
                if m:
                    current_session["hook_fires"][m.group(1)] += 1
                    continue
                m = _TOOL_PAT.search(line)
                if m:
                    current_session["tool_invocations"][m.group(1)] += 1
                    global_tool_invocations[m.group(1)] += 1
                    continue
                if _LIFESAVER_PAT.search(line):
                    current_session["lifesaver_count"] += 1
                    lifesaver_events += 1
                    line_ts = _extract_ts(line)
                    if line_ts >= recent_cutoff:
                        recent_lifesaver_events += 1
                    continue
                m = _COHERENCE_PAT.search(line)
                if m:
                    coherence_events[m.group(1)] += 1
                    line_ts = _extract_ts(line)
                    if line_ts >= recent_cutoff:
                        recent_coherence_events[m.group(1)] += 1
    except Exception as e:
        return {"_error": f"parse error: {e}", "sessions": [], "events": []}

    if current_session:
        sessions.append(current_session)

    # Convert defaultdicts to dicts for JSON serialization
    for s in sessions:
        s["hook_fires"] = dict(s["hook_fires"])
        s["tool_invocations"] = dict(s["tool_invocations"])

    return {
        "sessions": sessions,
        "total_log_lines": total_lines,
        "total_lifesaver_events": lifesaver_events,
        "recent_lifesaver_events": recent_lifesaver_events,
        "coherence_events": dict(coherence_events),
        "recent_coherence_events": dict(recent_coherence_events),
        "global_tool_invocations": dict(global_tool_invocations),
    }


def _extract_ts(line: str) -> float:
    """Parse a timestamp from a log line like '2026-04-13 19:20:46,610 INFO ...'."""
    m = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", line)
    if not m:
        return 0.0
    try:
        return time.mktime(time.strptime(m.group(1), "%Y-%m-%d %H:%M:%S"))
    except Exception:
        return 0.0


def _registered_hook_scripts() -> set:
    """Read hooks.json and extract the matcher names hooks are registered for."""
    try:
        with open(_HOOKS_JSON) as f:
            data = json.load(f)
    except Exception:
        return set()
    names = set()
    for _event, entries in data.get("hooks", {}).items():
        for entry in entries:
            m = entry.get("matcher", "")
            if m:
                names.add(m)
    return names


def compute_effectiveness() -> dict:
    raw = _parse_log()
    sessions = raw.get("sessions", [])
    if not sessions:
        return {
            "generated_at": time.time(),
            "_warning": "no sessions found in log",
            **raw,
        }

    # Per-tool stats
    tool_calls_total: dict = defaultdict(list)
    for s in sessions:
        for call in s["tool_calls"]:
            tool_calls_total[call["tool"]].append(call["latency_s"])
    tool_stats = {}
    for tool, latencies in tool_calls_total.items():
        latencies.sort()
        tool_stats[tool] = {
            "calls": len(latencies),
            "median_latency_s": latencies[len(latencies) // 2],
            "max_latency_s": latencies[-1],
            "min_latency_s": latencies[0],
        }

    # Per-hook stats across all sessions (both signals: explicit log + tool invocations)
    hook_totals: dict = defaultdict(int)
    tool_invocation_totals: dict = defaultdict(int)
    for s in sessions:
        for hk, n in s["hook_fires"].items():
            hook_totals[hk] += n
        for tool_name, n in s.get("tool_invocations", {}).items():
            tool_invocation_totals[tool_name] += n

    # Dead-hook detection: hooks registered but never seen fired.
    # A hook matcher is "alive" if EITHER a matching INFO tool: or INFO hook:
    # event appears in the log. Both signals count toward liveness.
    registered = _registered_hook_scripts()
    seen_matchers = set(hook_totals.keys()) | set(tool_invocation_totals.keys())
    native_matchers = {m for m in registered if not m.startswith("mcp__HME__") and m and m != "*"}
    dead_native_hooks = sorted(m for m in native_matchers if m not in seen_matchers)

    # Session aggregates
    session_lengths_s = []
    for s in sessions:
        if not s["tool_calls"]:
            continue
        ts = [c["ts"] for c in s["tool_calls"] if c["ts"]]
        if len(ts) >= 2:
            session_lengths_s.append(max(ts) - min(ts))
    avg_session_s = sum(session_lengths_s) / max(1, len(session_lengths_s))

    # Tool co-occurrence (pairs of tools called within the same session)
    pair_counts: dict = defaultdict(int)
    for s in sessions:
        tools_in_session = sorted(set(c["tool"] for c in s["tool_calls"]))
        for i in range(len(tools_in_session)):
            for j in range(i + 1, len(tools_in_session)):
                pair_counts[f"{tools_in_session[i]}×{tools_in_session[j]}"] += 1

    # LIFESAVER rate
    sessions_with_errors = sum(1 for s in sessions if s["lifesaver_count"] > 0)
    lifesaver_rate = sessions_with_errors / len(sessions) if sessions else 0.0

    # Trim sessions for persistence: drop large arrays that aren't needed
    # downstream, keep the fields the coupling matrix + HCI verifiers consume.
    slim_sessions = []
    for s in sessions:
        slim_sessions.append({
            "session_id": s["session_id"],
            "started_at": s["started_at"],
            "lifesaver_count": s["lifesaver_count"],
            # Only keep tool names per call, not full records
            "tool_calls": [{"tool": c["tool"], "latency_s": c["latency_s"]} for c in s["tool_calls"]],
            "hook_fires": s["hook_fires"],
            "tool_invocations": s.get("tool_invocations", {}),
        })

    return {
        "generated_at": time.time(),
        "total_log_lines": raw.get("total_log_lines", 0),
        "session_count": len(sessions),
        "avg_session_duration_s": round(avg_session_s, 1),
        "hme_tool_calls_total": sum(v["calls"] for v in tool_stats.values()),
        "hme_tool_stats": tool_stats,
        "hook_fire_counts": dict(sorted(hook_totals.items(), key=lambda x: -x[1])),
        "tool_invocation_counts": dict(sorted(tool_invocation_totals.items(), key=lambda x: -x[1])),
        "dead_native_hooks": dead_native_hooks,
        "hme_tool_pair_cooccurrence": dict(sorted(pair_counts.items(), key=lambda x: -x[1])[:30]),
        "lifesaver_total_events": raw.get("total_lifesaver_events", 0),
        "lifesaver_recent_events": raw.get("recent_lifesaver_events", 0),
        "lifesaver_session_rate": round(lifesaver_rate, 3),
        "coherence_events": raw.get("coherence_events", {}),
        "recent_coherence_events": raw.get("recent_coherence_events", {}),
        # Slim per-session records for the coupling matrix builder
        "sessions": slim_sessions,
    }


def format_summary(stats: dict) -> str:
    parts = [f"[tool-effectiveness]"]
    if "_warning" in stats:
        return f"[tool-effectiveness] {stats['_warning']}"
    parts.append(f"sessions={stats['session_count']}")
    parts.append(f"hme_calls={stats.get('hme_tool_calls_total', 0)}")
    parts.append(f"tool_invocations={sum(stats.get('tool_invocation_counts', {}).values())}")
    parts.append(f"lifesaver_rate={stats['lifesaver_session_rate']:.1%}")
    dead = stats.get("dead_native_hooks", [])
    if dead:
        parts.append(f"DEAD_HOOKS={len(dead)}:{','.join(dead[:3])}")
    return " | ".join(parts)


def main(argv: list) -> int:
    try:
        stats = compute_effectiveness()
    except Exception as e:
        import traceback
        sys.stderr.write(f"analyze error: {e}\n{traceback.format_exc()}")
        return 2

    if "--summary" in argv:
        print(format_summary(stats))
        return 0
    if "--stdout" in argv:
        print(json.dumps(stats, indent=2))
        return 0

    os.makedirs(os.path.dirname(_OUTPUT), exist_ok=True)
    with open(_OUTPUT, "w") as f:
        json.dump(stats, f, indent=2)
    print(f"Effectiveness written: {_OUTPUT}")
    print(format_summary(stats))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
