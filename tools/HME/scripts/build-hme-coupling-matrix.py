#!/usr/bin/env python3
"""HME-as-coupling-matrix builder.

Mirrors Polychron's compositional coupling matrix, but for HME's TOOL surface.
Every tool is a node. Every pair of tools has an edge weighted by their
co-occurrence within sessions AND by whether sessions containing that pair
had fewer LIFESAVER events than sessions without. The resulting matrix
lets HME detect:

  - Antagonist bridges: tool pairs that appear to reinforce each other but
    are under-coupled (rarely co-occur despite predicting success).
  - Redundant pairs: tools that co-occur so often they may be duplicating work.
  - Dead zones: tools that never co-occur with anything — suspect isolation.

The matrix is empirical, not prescriptive: it measures what the system does,
not what you think it should do. Feed the antagonist bridges to the
onboarding chain as candidate walkthrough additions.

Reads metrics/hme-tool-effectiveness.json. Writes metrics/hme-coupling.json.

Output schema:
    {
      "generated_at": epoch,
      "nodes": [tool names],
      "matrix": {tool_a: {tool_b: {"cooccurrence": int, "lift": float}}},
      "antagonist_bridges": [{"a": ..., "b": ..., "reason": ..., "strength": ...}],
      "dead_zones": [tools with no co-occurrences],
      "health_signal": {"avg_lift": float, "coverage": float}
    }

Usage:
    python3 tools/HME/scripts/build-hme-coupling-matrix.py
    python3 tools/HME/scripts/build-hme-coupling-matrix.py --summary
"""
import itertools
import json
import os
import sys
import time
from collections import defaultdict

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_EFFECTIVENESS = os.path.join(METRICS_DIR, "hme-tool-effectiveness.json")
_OUTPUT = os.path.join(METRICS_DIR, "hme-coupling.json")

# Tools we consider "HME surface" — both the public HME tools and the hooks
# that dispatch on native tool calls. Any tool co-occurring with these is a
# candidate for coupling analysis.
_HME_PUBLIC_TOOLS = {"evolve", "review", "learn", "trace", "hme_admin"}


def _load_sessions() -> list:
    if not os.path.isfile(_EFFECTIVENESS):
        return []
    try:
        with open(_EFFECTIVENESS) as f:
            data = json.load(f)
    except Exception:
        return []
    return data.get("sessions") or _reconstruct_sessions(data)


def _reconstruct_sessions(data: dict) -> list:
    """Older effectiveness files only have aggregate stats — try to reconstruct
    a session list from the raw tool_invocation_counts + session_count."""
    return []


def build_matrix() -> dict:
    # Load the effectiveness JSON directly — sessions are nested inside
    if not os.path.isfile(_EFFECTIVENESS):
        return {
            "generated_at": time.time(),
            "_error": "no effectiveness data — run analyze-tool-effectiveness.py first",
        }

    try:
        with open(_EFFECTIVENESS) as f:
            data = json.load(f)
    except Exception as e:
        return {"generated_at": time.time(), "_error": str(e)}

    # Some layouts include sessions (full), others only include aggregates.
    # Re-parse the log directly when sessions aren't included.
    sessions = data.get("sessions")
    if sessions is None:
        # Trigger the analyzer to re-run WITH sessions included
        import subprocess
        _effectiveness_script = os.path.join(_PROJECT, "tools", "HME", "scripts", "analyze-tool-effectiveness.py")
        if os.path.isfile(_effectiveness_script):
            subprocess.run(["python3", _effectiveness_script],
                           capture_output=True, env={**os.environ, "PROJECT_ROOT": _PROJECT},
                           timeout=30)
            with open(_EFFECTIVENESS) as f:
                data = json.load(f)
            sessions = data.get("sessions")
    sessions = sessions or []

    # Collect unique tool set across all sessions
    all_tools: set = set()
    for s in sessions:
        for c in s.get("tool_calls", []):
            all_tools.add(c.get("tool", ""))
        for t in s.get("tool_invocations", {}):
            all_tools.add(t)
    all_tools.discard("")
    nodes = sorted(all_tools)

    if not nodes:
        return {
            "generated_at": time.time(),
            "nodes": [],
            "matrix": {},
            "antagonist_bridges": [],
            "dead_zones": [],
            "health_signal": {"avg_lift": 0.0, "coverage": 0.0},
            "_warning": "no tool events found in session data",
        }

    # Build per-session tool sets (ignore order — binary presence per session)
    session_tool_sets: list = []
    session_has_error: list = []
    for s in sessions:
        tools = set()
        for c in s.get("tool_calls", []):
            tools.add(c.get("tool", ""))
        for t in s.get("tool_invocations", {}):
            tools.add(t)
        tools.discard("")
        session_tool_sets.append(tools)
        session_has_error.append(s.get("lifesaver_count", 0) > 0)

    total_sessions = len(session_tool_sets)
    if total_sessions == 0:
        return {
            "generated_at": time.time(),
            "nodes": nodes,
            "matrix": {},
            "antagonist_bridges": [],
            "dead_zones": nodes,
            "health_signal": {"avg_lift": 0.0, "coverage": 0.0},
        }

    # Tool frequency base rate
    tool_freq: dict = defaultdict(int)
    for tools in session_tool_sets:
        for t in tools:
            tool_freq[t] += 1

    # Pairwise co-occurrence + lift (does co-occurrence correlate with clean sessions?)
    matrix: dict = {}
    for a, b in itertools.combinations(nodes, 2):
        cooccurrence = 0
        clean_with_both = 0
        clean_without_both = 0
        total_without_both = 0
        for i, tools in enumerate(session_tool_sets):
            has_both = (a in tools) and (b in tools)
            clean = not session_has_error[i]
            if has_both:
                cooccurrence += 1
                if clean:
                    clean_with_both += 1
            else:
                total_without_both += 1
                if clean:
                    clean_without_both += 1
        if cooccurrence == 0:
            continue  # skip empty entries to keep matrix sparse

        # Lift: P(clean | has both) / P(clean | not has both)
        p_clean_with = clean_with_both / cooccurrence if cooccurrence else 0
        p_clean_without = clean_without_both / total_without_both if total_without_both else 0
        if p_clean_without > 0:
            lift = p_clean_with / p_clean_without
        else:
            lift = 1.0 if p_clean_with > 0 else 0.0
        matrix.setdefault(a, {})[b] = {
            "cooccurrence": cooccurrence,
            "clean_rate": round(p_clean_with, 3),
            "lift": round(lift, 3),
        }

    # Antagonist bridge detection: pairs with high individual frequency but
    # low co-occurrence. If A appears in 50% of sessions and B appears in 50%
    # but they never co-occur, that's an under-coupled pair worth examining.
    bridges = []
    for a, b in itertools.combinations(nodes, 2):
        fa = tool_freq[a] / total_sessions
        fb = tool_freq[b] / total_sessions
        expected = fa * fb * total_sessions
        actual = matrix.get(a, {}).get(b, {}).get("cooccurrence", 0)
        if expected >= 2.0 and actual < expected * 0.3:
            bridges.append({
                "a": a,
                "b": b,
                "expected": round(expected, 2),
                "actual": actual,
                "gap": round(expected - actual, 2),
                "reason": "under-coupled — expected co-occurrence based on individual frequencies",
            })
    bridges.sort(key=lambda x: -x["gap"])

    # Dead zones: tools with no co-occurrence with any other tool
    dead_zones = []
    for t in nodes:
        cooc_sum = sum(
            (matrix.get(t, {}) or {}).get(other, {}).get("cooccurrence", 0)
            for other in nodes
            if other != t
        ) + sum(
            (matrix.get(other, {}) or {}).get(t, {}).get("cooccurrence", 0)
            for other in nodes
            if other != t
        )
        if cooc_sum == 0 and tool_freq.get(t, 0) > 0:
            dead_zones.append(t)

    # Health signal
    lifts = [info["lift"] for row in matrix.values() for info in row.values()]
    avg_lift = sum(lifts) / len(lifts) if lifts else 0.0
    coverage = len(matrix) / max(1, len(nodes)) if nodes else 0.0

    return {
        "generated_at": time.time(),
        "session_count": total_sessions,
        "nodes": nodes,
        "node_count": len(nodes),
        "tool_frequency": dict(sorted(tool_freq.items(), key=lambda x: -x[1])),
        "matrix": matrix,
        "antagonist_bridges": bridges[:10],
        "dead_zones": dead_zones,
        "health_signal": {
            "avg_lift": round(avg_lift, 3),
            "coverage": round(coverage, 3),
            "edge_count": sum(len(row) for row in matrix.values()),
        },
    }


def format_summary(m: dict) -> str:
    if "_error" in m:
        return f"[hme-coupling] ERROR: {m['_error']}"
    if m.get("_warning"):
        return f"[hme-coupling] {m['_warning']}"
    nodes = m.get("node_count", 0)
    edges = m.get("health_signal", {}).get("edge_count", 0)
    avg_lift = m.get("health_signal", {}).get("avg_lift", 0.0)
    bridges = len(m.get("antagonist_bridges", []))
    dead = len(m.get("dead_zones", []))
    return f"[hme-coupling] nodes={nodes} edges={edges} avg_lift={avg_lift:.2f} bridges={bridges} dead={dead}"


def main(argv: list) -> int:
    try:
        matrix = build_matrix()
    except Exception as e:
        import traceback
        sys.stderr.write(f"build error: {e}\n{traceback.format_exc()}")
        return 2
    if "--summary" in argv:
        print(format_summary(matrix))
        return 0
    if "--stdout" in argv:
        print(json.dumps(matrix, indent=2))
        return 0
    os.makedirs(os.path.dirname(_OUTPUT), exist_ok=True)
    with open(_OUTPUT, "w") as f:
        json.dump(matrix, f, indent=2)
    print(f"Coupling matrix written: {_OUTPUT}")
    print(format_summary(matrix))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
