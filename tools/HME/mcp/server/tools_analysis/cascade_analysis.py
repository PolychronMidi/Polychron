"""HME causal chain indexing — Phase 2.5 of openshell_features_to_mimic.md.

Forward-causal traversal: given a module, predict the impact chain of
changing it. Merges three topology sources:

  1. metrics/dependency-graph.json — global producer→consumer edges
     between files
  2. metrics/feedback_graph.json   — declared feedback loops + firewall ports
  3. metrics/conductor-map.md (optional) — L0 channel producer/consumer
     registry; parsed loosely since the JSON form is not guaranteed

Consumed via `trace(target=..., mode='impact')` or directly through
`cascade_report(target, depth=3)`.

The output is a markdown digest the Evolver can read during Phase 2
diagnosis to reason about second- and third-order consequences before
making an edit, rather than after the pipeline flags them.
"""
from __future__ import annotations

import json
import os
from collections import deque
from typing import Any

from server import context as ctx
from . import _track

DEP_GRAPH_REL = os.path.join("output", "metrics", "dependency-graph.json")
FEEDBACK_GRAPH_REL = os.path.join("output", "metrics", "feedback_graph.json")
PREDICTIONS_LOG_REL = os.path.join("output", "metrics", "hme-predictions.jsonl")

_CACHE: dict[str, Any] = {}


def _log_prediction(target_module: str, affected_modules: list[str], injected: bool = False) -> None:
    """Phase 3.4 — append one prediction record to hme-predictions.jsonl so
    the post-pipeline reconciler can later compare against fingerprint shifts.
    Best-effort; never raises.

    Phase 6.1 addition: `injected` flag marks whether this prediction was
    surfaced to the Evolver via proxy injection BEFORE the edit was made.
    Injected predictions are *influence*, not *accuracy* — the Evolver
    acted knowing the prediction, so confirmation is partly self-fulfilling.
    The reconciler splits these into separate buckets.
    """
    try:
        import json as _json
        import time as _time
        path = os.path.join(ctx.PROJECT_ROOT, PREDICTIONS_LOG_REL)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        record = {
            "ts": int(_time.time()),
            "event": "cascade_prediction",
            "target": target_module,
            "predicted": affected_modules,
            "injected": bool(injected),
        }
        with open(path, "a", encoding="utf-8") as f:
            f.write(_json.dumps(record, separators=(",", ":")) + "\n")
    except OSError as _cascade_err:
        # Silently losing cascade records breaks the entire prediction-
        # accuracy validation loop (downstream scripts read this file to
        # score cascade predictions). LIFESAVER so degraded observability
        # isn't discoverable only via "why are our cascade metrics flat?"
        logger.error(f"cascade record append FAILED: {type(_cascade_err).__name__}: {_cascade_err}")
        try:
            from server import context as _ctx
            _ctx.register_critical_failure(
                "cascade_analysis.record_append",
                f"cascade record lost ({type(_cascade_err).__name__}); prediction-accuracy loop is now missing data",
                severity="CRITICAL",
            )
        except Exception as _life_err:
            logger.debug(f"LIFESAVER register failed: {_life_err}")


def _load_dep_graph() -> dict:
    if "dep" in _CACHE:
        return _CACHE["dep"]
    path = os.path.join(ctx.PROJECT_ROOT, DEP_GRAPH_REL)
    if not os.path.exists(path):
        _CACHE["dep"] = {"nodes": {}, "edges": []}
        return _CACHE["dep"]
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        data = {"nodes": {}, "edges": []}
    _CACHE["dep"] = data
    return data


def _load_feedback_graph() -> dict:
    if "fb" in _CACHE:
        return _CACHE["fb"]
    path = os.path.join(ctx.PROJECT_ROOT, FEEDBACK_GRAPH_REL)
    if not os.path.exists(path):
        _CACHE["fb"] = {}
        return _CACHE["fb"]
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        data = {}
    _CACHE["fb"] = data
    return data


def invalidate_cache() -> None:
    """Force reloads of the graphs on next access. Called by the file
    watcher when dependency-graph.json rebuilds."""
    _CACHE.clear()


def _normalize_target(target: str) -> tuple[str, str]:
    """Return (best_file_path, canonical_stem). Accepts either a module
    name (e.g. 'conductorIntelligence') or a file path (e.g.
    'src/conductor/conductorIntelligence.js')."""
    nodes = _load_dep_graph().get("nodes", {})
    if target in nodes:
        stem = os.path.splitext(os.path.basename(target))[0]
        return target, stem
    # Try module-name lookup: find node whose basename matches
    stem = target
    if stem.endswith(".js"):
        stem = stem[:-3]
    for path in nodes:
        base = os.path.splitext(os.path.basename(path))[0]
        if base == stem:
            return path, stem
    # Fallback: substring match
    for path in nodes:
        if stem in path:
            return path, stem
    return target, stem


def _forward_bfs(start: str, depth: int) -> list[tuple[int, str, list[str]]]:
    """BFS from `start` following producer→consumer edges, up to `depth`
    hops. Returns [(hop, node, globals_bridging_edge), ...]."""
    dep = _load_dep_graph()
    edges = dep.get("edges", [])
    # Index outbound edges for O(1) lookup
    out_index: dict[str, list[dict]] = {}
    for e in edges:
        out_index.setdefault(e["from"], []).append(e)

    visited: set[str] = {start}
    order: list[tuple[int, str, list[str]]] = []
    queue: deque[tuple[str, int, list[str]]] = deque([(start, 0, [])])
    while queue:
        node, hop, via = queue.popleft()
        if hop > 0:
            order.append((hop, node, via))
        if hop >= depth:
            continue
        for e in out_index.get(node, []):
            tgt = e.get("to")
            if not tgt or tgt in visited:
                continue
            visited.add(tgt)
            queue.append((tgt, hop + 1, e.get("globals", []) or []))
    return order


def _reverse_callers(target_path: str) -> list[tuple[str, list[str]]]:
    """Who depends on target? Inbound edges."""
    dep = _load_dep_graph()
    callers: list[tuple[str, list[str]]] = []
    for e in dep.get("edges", []):
        if e.get("to") == target_path:
            callers.append((e.get("from", "?"), e.get("globals", []) or []))
    return callers


def _feedback_loops_touching(stem: str) -> list[dict]:
    """Return feedback loops that mention the module stem."""
    fb = _load_feedback_graph()
    loops = fb.get("feedbackLoops", []) or []
    hits: list[dict] = []
    for loop in loops:
        blob = json.dumps(loop)
        if stem in blob:
            hits.append(loop)
    return hits


def _firewall_ports_touching(stem: str) -> list[dict]:
    fb = _load_feedback_graph()
    ports = fb.get("firewallPorts", []) or []
    return [p for p in ports if stem in json.dumps(p)]


def cascade_report(target: str, depth: int = 3) -> str:
    """Produce a markdown impact-chain report for a module.

    target: module name (e.g. 'conductorIntelligence') or file path under
            src/ (e.g. 'src/conductor/conductorIntelligence.js').
    depth:  how many hops to traverse forward (default 3, max 5).
    """
    _track("cascade_report")

    depth = max(1, min(int(depth or 3), 5))
    path, stem = _normalize_target(target)
    dep = _load_dep_graph()
    nodes = dep.get("nodes", {})

    if path not in nodes:
        return (
            f"# Cascade Report: {target}\n\n"
            f"Module not found in dependency graph (looked for `{path}`).\n"
            f"Regenerate with: node scripts/pipeline/generate-dependency-graph.js"
        )

    node_info = nodes[path]
    provides = node_info.get("provides", []) or []
    consumes = node_info.get("consumes", []) or []
    subsystem = node_info.get("subsystem", "?")

    # Forward chain
    forward = _forward_bfs(path, depth)
    by_hop: dict[int, list[tuple[str, list[str]]]] = {}
    for hop, node, via in forward:
        by_hop.setdefault(hop, []).append((node, via))

    # Phase 3.4: log this prediction so post-pipeline can reconcile. Use
    # module stems (not full paths) to match how fingerprint-comparison
    # reports changed trust systems / modules.
    affected_stems: list[str] = []
    for _hop, node, _via in forward:
        s = os.path.splitext(os.path.basename(node))[0]
        if s and s not in affected_stems:
            affected_stems.append(s)
    _log_prediction(target_module=stem, affected_modules=affected_stems)

    # Reverse callers (1 hop only, for centrality context)
    callers = _reverse_callers(path)

    # Feedback topology
    fb_loops = _feedback_loops_touching(stem)
    fw_ports = _firewall_ports_touching(stem)

    lines = [
        f"# Cascade Report: `{stem}`",
        "",
        f"**File:** `{path}`",
        f"**Subsystem:** {subsystem}",
        f"**Direct callers (1 hop):** {len(callers)}",
        f"**Reach at depth {depth}:** {len(forward)} files",
        "",
    ]

    if provides or consumes:
        lines.append("## Registry")
        if provides:
            lines.append(f"  provides: {', '.join(provides)}")
        if consumes:
            lines.append(f"  consumes: {', '.join(consumes[:10])}"
                         + (f" (+{len(consumes)-10} more)" if len(consumes) > 10 else ""))
        lines.append("")

    lines.append("## Forward impact chain")
    if not by_hop:
        lines.append("  No forward edges from this module.")
    else:
        for hop in sorted(by_hop.keys()):
            hits = by_hop[hop]
            lines.append(f"  hop {hop} ({len(hits)} file{'s' if len(hits) != 1 else ''}):")
            for node, via in hits[:15]:
                via_s = f" via {','.join(via[:3])}" if via else ""
                lines.append(f"    - {node}{via_s}")
            if len(hits) > 15:
                lines.append(f"    … and {len(hits) - 15} more")
        # Tabulate top subsystems affected
        sub_count: dict[str, int] = {}
        for _hop, node, _via in forward:
            parts = node.split("/")
            if "src" in parts:
                idx = parts.index("src")
                if idx + 1 < len(parts):
                    sub = parts[idx + 1] if "." not in parts[idx + 1] else "index"
                    sub_count[sub] = sub_count.get(sub, 0) + 1
        if sub_count:
            lines.append("")
            lines.append("  subsystems in blast radius:")
            for sub, n in sorted(sub_count.items(), key=lambda x: -x[1]):
                lines.append(f"    {sub:<12} {n}")

    if fb_loops:
        lines.append("")
        lines.append(f"## Feedback loops touching `{stem}` ({len(fb_loops)})")
        for loop in fb_loops[:8]:
            lid = loop.get("id", "?")
            desc = loop.get("description") or loop.get("label") or ""
            lines.append(f"  - {lid}: {desc[:80]}")

    if fw_ports:
        lines.append("")
        lines.append(f"## Firewall ports touching `{stem}` ({len(fw_ports)})")
        for port in fw_ports[:5]:
            pid = port.get("id", "?")
            desc = port.get("description") or port.get("label") or ""
            lines.append(f"  - {pid}: {desc[:80]}")

    if callers:
        lines.append("")
        lines.append(f"## Top reverse callers ({min(len(callers), 10)} of {len(callers)})")
        for caller, via in callers[:10]:
            via_s = f" via {','.join(via[:3])}" if via else ""
            lines.append(f"  - {caller}{via_s}")

    lines.append("")
    lines.append(
        "## Interpretation",
    )
    lines.append(
        f"  Editing `{stem}` likely affects {len(forward)} downstream file(s) across "
        f"{len(by_hop)} hop(s). Before committing, read the KB for the top "
        f"callers and for any modules inside the feedback loops above."
    )

    return "\n".join(lines)


def cascade_summary(target: str) -> dict:
    """Compact machine-readable summary for use by the proxy / injection
    layer. Returns a dict — not a markdown string."""
    path, stem = _normalize_target(target)
    dep = _load_dep_graph()
    nodes = dep.get("nodes", {})
    if path not in nodes:
        return {"found": False, "target": target}
    forward = _forward_bfs(path, 2)
    callers = _reverse_callers(path)
    fb_loops = _feedback_loops_touching(stem)
    return {
        "found": True,
        "module": stem,
        "path": path,
        "subsystem": nodes[path].get("subsystem", "?"),
        "direct_callers": len(callers),
        "forward_reach_depth2": len(forward),
        "feedback_loops": [loop.get("id", "?") for loop in fb_loops[:5]],
        "provides": nodes[path].get("provides", []) or [],
        "consumes_count": len(nodes[path].get("consumes", []) or []),
    }
