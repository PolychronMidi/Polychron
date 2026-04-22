"""HME architectural negative-space discovery — Phase 5.3.

Finds structural gaps in Polychron's topology that aren't blind spots
(omissions the Evolver never considered) but genuine theoretical absences
the system's own structure predicts.

v1 scopes to two mechanical detectors (no semantic similarity):

  1. **Feedback loop near-misses** — feedback_graph.json feedbackLoops
     entries list participant modules. For each loop, we compute the set
     of "co-referenced" modules: modules whose dependency-graph edges
     touch ≥K of the loop participants but who are NOT themselves listed
     in the loop. If the co-reference count is ≥ floor(|loop|/2) and the
     candidate isn't in the loop, it's a near-miss.

  2. **Co-consumed pairs** — the dependency-graph has producer→consumer
     edges. For every pair of modules that are consumed by ≥5 shared
     consumers but have no direct edge between them, we emit a negative-
     space candidate. These are modules the rest of the architecture
     treats as functionally related without an explicit wiring.

Output: metrics/hme-negative-space.json with ranked candidates +
confidence scores. Surfaced via `status(mode='negative_space')`.

Read-only. Never modifies graphs or KB. Generates structural
predictions the Evolver can then confirm or refute.
"""
from __future__ import annotations

import json
import os
import time
from collections import defaultdict

from server import context as ctx
from . import _track

DEP_GRAPH_REL = os.path.join("output", "metrics", "dependency-graph.json")
FEEDBACK_GRAPH_REL = os.path.join("output", "metrics", "feedback_graph.json")
OUT_REL = os.path.join("output", "metrics", "hme-negative-space.json")


def _load(rel: str) -> dict | None:
    path = os.path.join(ctx.PROJECT_ROOT, rel)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _dep_graph_edges() -> tuple[list[dict], dict[str, set[str]], dict[str, set[str]]]:
    """Return (edges, out_by_from, in_by_to) where out/in map a file path
    to the set of files it produces to / consumes from."""
    dep = _load(DEP_GRAPH_REL) or {}
    edges = dep.get("edges", []) or []
    out_by_from: dict[str, set[str]] = defaultdict(set)
    in_by_to: dict[str, set[str]] = defaultdict(set)
    for e in edges:
        frm = e.get("from")
        to = e.get("to")
        if not frm or not to:
            continue
        out_by_from[frm].add(to)
        in_by_to[to].add(frm)
    return edges, out_by_from, in_by_to


def _module_stem(path: str) -> str:
    return os.path.splitext(os.path.basename(path))[0]


def find_feedback_loop_near_misses() -> list[dict]:
    fb = _load(FEEDBACK_GRAPH_REL) or {}
    loops = fb.get("feedbackLoops", []) or []
    dep = _load(DEP_GRAPH_REL) or {}
    nodes = dep.get("nodes", {}) or {}
    _edges, out_by_from, in_by_to = _dep_graph_edges()

    # Index: stem → file path (first match wins)
    stem_to_path: dict[str, str] = {}
    for p in nodes:
        stem_to_path.setdefault(_module_stem(p), p)

    # Universality filter — a module whose provided globals are imported
    # by more than UNIVERSAL_THRESHOLD files is infrastructure, not a loop
    # candidate. validator, clamps, index, l0Channels get filtered out
    # this way without hand-maintained blacklists. Note: for a producer P,
    # `out_by_from[P]` is the set of consumer files (direction reads as
    # "P produces FOR x"), so producer fan-out == infrastructure scale.
    UNIVERSAL_THRESHOLD = 30
    universal_paths: set[str] = {
        p for p in nodes if len(out_by_from.get(p, set())) >= UNIVERSAL_THRESHOLD
    }

    candidates: list[dict] = []

    for loop in loops:
        loop_id = loop.get("id", "?")
        # feedbackLoops entries don't have a canonical 'modules' list — we
        # pull stems out of the whole JSON blob. Skip metadata keys.
        blob = json.dumps(loop)
        # Find every CamelCase-ish identifier ≥4 chars
        import re
        stems = set(re.findall(r"\b([a-z][a-zA-Z0-9]{3,})\b", blob))
        # Only keep stems we recognize as real modules
        loop_stems = {s for s in stems if s in stem_to_path}
        if len(loop_stems) < 3:
            continue  # loop too small to have meaningful near-misses
        loop_paths = {stem_to_path[s] for s in loop_stems}

        # For each loop member, collect all files they depend on (out) and
        # all files that depend on them (in). Near-miss candidates are
        # files that touch ≥threshold loop members but aren't in the loop.
        touch_count: dict[str, int] = defaultdict(int)
        for member in loop_paths:
            for neighbor in out_by_from.get(member, set()) | in_by_to.get(member, set()):
                if neighbor in loop_paths:
                    continue
                touch_count[neighbor] += 1

        threshold = max(2, len(loop_paths) // 2)
        for candidate_path, n in touch_count.items():
            if n < threshold:
                continue
            if candidate_path in universal_paths:
                continue  # skip infrastructure modules
            confidence = min(1.0, n / len(loop_paths))
            candidates.append({
                "kind": "feedback_loop_near_miss",
                "loop_id": loop_id,
                "loop_size": len(loop_paths),
                "candidate_module": _module_stem(candidate_path),
                "candidate_path": candidate_path,
                "touches_loop_members": n,
                "confidence": round(confidence, 3),
                "reasoning": (
                    f"touches {n}/{len(loop_paths)} loop participants but is not "
                    f"registered in the loop"
                ),
            })
    candidates.sort(key=lambda c: -c["confidence"])
    return candidates


def find_co_consumed_pairs(min_shared: int = 5, max_results: int = 50) -> list[dict]:
    _edges, out_by_from, in_by_to = _dep_graph_edges()

    # Universality filter — same logic as above. Core utilities like
    # validator / clamps / l0Channels get consumed by every file and
    # would otherwise dominate the pair rankings.
    UNIVERSAL_THRESHOLD = 30
    universal_paths: set[str] = set()
    # We need to know in-degree which means counting how many files list
    # each as a producer. out_by_from[A] = producers consumed by A, so
    # invert once.

    # For each consumer, list the set of modules it consumes from. Then
    # invert: for each pair (A, B) of modules, count how many consumers
    # import BOTH. Finally, require that (A, B) has no direct producer→
    # consumer edge between them.

    # Step 1: map producer → set of consumers (already have out_by_from,
    # where out_by_from[A] = {files A depends on}). Invert: for each
    # consumer X, list the set of producers it pulls from.
    producers_by_consumer: dict[str, set[str]] = defaultdict(set)
    producer_consumer_count: dict[str, int] = defaultdict(int)
    for frm, tos in out_by_from.items():
        for to in tos:
            producers_by_consumer[to].add(frm)
            producer_consumer_count[frm] += 1
    universal_paths = {p for p, n in producer_consumer_count.items() if n >= UNIVERSAL_THRESHOLD}

    # Step 2: for each pair of producers, count shared consumers.
    pair_shared: dict[tuple[str, str], int] = defaultdict(int)
    for consumer, producers in producers_by_consumer.items():
        # Skip consumers with huge producer sets — they blow up the count
        # without revealing meaningful structure.
        if len(producers) > 20:
            continue
        plist = sorted(producers)
        for i in range(len(plist)):
            for j in range(i + 1, len(plist)):
                pair_shared[(plist[i], plist[j])] += 1

    # Step 3: keep pairs with ≥min_shared AND no direct edge
    candidates: list[dict] = []
    for (a, b), n in pair_shared.items():
        if n < min_shared:
            continue
        if a in universal_paths or b in universal_paths:
            continue  # infrastructure module, not a meaningful gap
        # No direct edge in either direction
        if b in out_by_from.get(a, set()) or a in out_by_from.get(b, set()):
            continue
        confidence = min(1.0, n / 10.0)
        candidates.append({
            "kind": "co_consumed_pair",
            "module_a": _module_stem(a),
            "path_a": a,
            "module_b": _module_stem(b),
            "path_b": b,
            "shared_consumers": n,
            "confidence": round(confidence, 3),
            "reasoning": (
                f"{n} files consume from both but no direct edge exists — "
                f"functional relationship treated as implicit by the rest "
                f"of the architecture"
            ),
        })
    candidates.sort(key=lambda c: -c["shared_consumers"])
    return candidates[:max_results]


def compute_negative_space() -> dict:
    _track("negative_space")
    near_misses = find_feedback_loop_near_misses()
    co_consumed = find_co_consumed_pairs()
    report = {
        "meta": {
            "script": "negative_space.py",
            "timestamp": int(time.time()),
            "near_miss_count": len(near_misses),
            "co_consumed_count": len(co_consumed),
        },
        "feedback_loop_near_misses": near_misses[:30],
        "co_consumed_pairs": co_consumed[:30],
    }
    out_path = os.path.join(ctx.PROJECT_ROOT, OUT_REL)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    return report


def negative_space_report() -> str:
    _track("negative_space_report")
    report = compute_negative_space()
    near = report.get("feedback_loop_near_misses") or []
    cop = report.get("co_consumed_pairs") or []
    lines = [
        "# HME Architectural Negative Space",
        "",
        f"Feedback loop near-misses: {report['meta']['near_miss_count']}",
        f"Co-consumed orphan pairs:  {report['meta']['co_consumed_count']}",
        "",
    ]
    if near:
        lines.append("## Feedback loop near-misses")
        lines.append("  Modules that touch N-of-N members of a registered loop but")
        lines.append("  aren't in the loop. High confidence = strong structural hint")
        lines.append("  the module should be added to the loop.")
        lines.append("")
        for c in near[:15]:
            lines.append(
                f"  {c['confidence']:.2f}  `{c['candidate_module']}`  → "
                f"{c['loop_id']}  ({c['touches_loop_members']}/{c['loop_size']})"
            )
            lines.append(f"    {c['reasoning']}")
        lines.append("")
    if cop:
        lines.append("## Co-consumed orphan pairs")
        lines.append("  Module pairs imported together by many files but with no")
        lines.append("  direct wiring. The architecture treats them as related")
        lines.append("  without an explicit edge.")
        lines.append("")
        for c in cop[:15]:
            lines.append(
                f"  {c['shared_consumers']:>3} shared  `{c['module_a']}` ↔ `{c['module_b']}`"
            )
        lines.append("")
    if not near and not cop:
        lines.append("No structural asymmetries detected.")
    return "\n".join(lines)
