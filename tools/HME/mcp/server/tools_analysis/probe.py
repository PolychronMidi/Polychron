"""HME adversarial self-probing — Phase 4.5 of openshell_features_to_mimic.md.

Generates probe *candidates*: deliberately boundary-pushing evolution
proposals that HME expects its current model to be wrong about. The
Evolver runs them in lab sketches (not main), observes the actual
outcome, and feeds the delta back into HME's trust weights and cascade
model.

Candidates are drawn from the intersection of three signals:

  1. **Blind spots** — subsystems untouched in the last N rounds, or
     modules never read-before-write (from blindspots.py).
  2. **Low cascade confidence** — modules at a subsystem intersection
     whose forward reach crosses ≥3 subsystems (from cascade_analysis).
  3. **Low trust coverage** — modules with no high-trust KB entries
     (from kb-trust-weights.json when available).

This module never *runs* a probe — it only produces candidates. The
Evolver decides which (if any) to execute in a lab sketch.

Output: metrics/hme-probes.json with candidate list and provenance.
Surfaced via `status(mode='probes')`. Also callable via
`evolve(focus='probe')` once wired.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any

from server import context as ctx
from . import _track

BLINDSPOTS_REL = os.path.join("metrics", "hme-blindspots.json")  # informational
ACCURACY_REL = os.path.join("metrics", "hme-prediction-accuracy.json")
TRUST_REL = os.path.join("metrics", "kb-trust-weights.json")
DEP_GRAPH_REL = os.path.join("metrics", "dependency-graph.json")
OUT_REL = os.path.join("metrics", "hme-probes.json")


def _load_json(rel: str):
    path = os.path.join(ctx.PROJECT_ROOT, rel)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _collect_intersection_modules() -> list[dict]:
    """Return modules whose forward edges span ≥3 distinct subsystems.
    These are structural intersection points where cascade confidence is
    most likely to be wrong."""
    dep = _load_json(DEP_GRAPH_REL) or {}
    edges = dep.get("edges", []) or []
    nodes = dep.get("nodes", {}) or {}

    # Index outbound edges per node
    out_index: dict[str, list[dict]] = {}
    for e in edges:
        out_index.setdefault(e.get("from") or "", []).append(e)

    def subsystem_of(path: str) -> str | None:
        parts = path.split("/")
        if "src" in parts:
            idx = parts.index("src")
            if idx + 1 < len(parts):
                first = parts[idx + 1]
                if "." not in first:
                    return first
        return None

    out: list[dict] = []
    for path in nodes:
        own_sub = subsystem_of(path)
        if not own_sub:
            continue
        reached: set[str] = set()
        for e in out_index.get(path, []):
            sub = subsystem_of(e.get("to") or "")
            if sub and sub != own_sub:
                reached.add(sub)
        if len(reached) >= 3:
            stem = os.path.splitext(os.path.basename(path))[0]
            out.append({
                "module": stem,
                "file_path": path,
                "own_subsystem": own_sub,
                "reaches_subsystems": sorted(reached),
                "intersection_count": len(reached),
            })
    out.sort(key=lambda m: -m["intersection_count"])
    return out


def _trust_by_module() -> dict[str, str]:
    """Map module-stem → best-tier KB entry we have. Stems with no matching
    entry get tier 'NONE'."""
    trust = _load_json(TRUST_REL) or {}
    entries = trust.get("entries", {}) or {}
    out: dict[str, str] = {}
    tier_order = {"HIGH": 2, "MED": 1, "LOW": 0, "NONE": -1}
    for e in entries.values():
        title = str(e.get("title", "")).lower()
        tier = e.get("tier", "LOW")
        # Match any module-name-shaped token in the title
        import re
        for m in re.finditer(r"\b([a-z][a-zA-Z0-9]{3,}(?:[A-Z][a-zA-Z0-9]+)+)\b", title):
            tok = m.group(1)
            prev = out.get(tok, "NONE")
            if tier_order[tier] > tier_order[prev]:
                out[tok] = tier
    return out


def _cascade_accuracy_estimate() -> float | None:
    data = _load_json(ACCURACY_REL) or {}
    ema = data.get("ema")
    if isinstance(ema, (int, float)):
        return float(ema)
    return None


def generate_probes(max_candidates: int = 5) -> dict:
    """Produce probe candidates. Returns the report dict and writes it."""
    _track("generate_probes")
    intersections = _collect_intersection_modules()
    trust_by_module = _trust_by_module()
    accuracy_ema = _cascade_accuracy_estimate()

    # Score candidates: higher score = better probe target
    # Score = intersection_count × (2 if trust is NONE/LOW else 1)
    #                         × (2 if accuracy_ema < 0.5 or unknown else 1)
    scored: list[dict] = []
    for m in intersections:
        stem = m["module"]
        trust_tier = trust_by_module.get(stem, "NONE")
        trust_multiplier = 2.0 if trust_tier in ("NONE", "LOW") else 1.0
        accuracy_multiplier = (
            2.0 if (accuracy_ema is None or accuracy_ema < 0.5) else 1.0
        )
        score = m["intersection_count"] * trust_multiplier * accuracy_multiplier
        scored.append({
            **m,
            "trust_tier": trust_tier,
            "cascade_accuracy_ema": accuracy_ema,
            "score": round(score, 2),
        })

    scored.sort(key=lambda c: (-c["score"], -c["intersection_count"]))
    candidates = scored[:max_candidates]

    # For each probe, attach a predicted cascade (depth 2) so the Evolver
    # can run it in a lab sketch and compare against the prediction.
    try:
        from .cascade_analysis import cascade_summary
        for c in candidates:
            summary = cascade_summary(c["module"])
            if summary.get("found"):
                c["predicted_cascade"] = {
                    "feedback_loops": summary.get("feedback_loops") or [],
                    "forward_reach_depth2": summary.get("forward_reach_depth2", 0),
                    "direct_callers": summary.get("direct_callers", 0),
                }
            c["predicted_confidence"] = (
                "LOW" if (accuracy_ema is None or accuracy_ema < 0.5) else "MEDIUM"
            )
    except Exception as _e:  # noqa: BLE001
        import logging
        logging.getLogger("HME").debug(f"probe cascade augmentation failed: {_e}")

    report = {
        "meta": {
            "script": "probe.py",
            "timestamp": int(time.time()),
            "total_intersections_found": len(intersections),
            "candidates_returned": len(candidates),
            "cascade_accuracy_ema": accuracy_ema,
        },
        "candidates": candidates,
    }
    out_path = os.path.join(ctx.PROJECT_ROOT, OUT_REL)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    return report


def probes_report() -> str:
    _track("probes_report")
    report = generate_probes()
    candidates = report["candidates"]
    lines = [
        "# HME Adversarial Probe Candidates",
        "",
        f"Total structural intersection modules: {report['meta']['total_intersections_found']}",
        f"Top candidates: {len(candidates)}",
        "",
        "Probes are deliberately-targeted evolution proposals for modules where",
        "HME's current model is most likely to be wrong. Run each in a lab sketch",
        "(not main), observe the actual cascade, and feed the delta back into",
        "HME's trust weights.",
        "",
    ]
    if not candidates:
        lines.append("No probe candidates — HME either has high cascade accuracy or")
        lines.append("there are no subsystem-intersection modules without strong KB coverage.")
        return "\n".join(lines)
    for i, c in enumerate(candidates, 1):
        lines.append(f"## Probe {i}: `{c['module']}`  (score={c['score']})")
        lines.append(f"  file:          {c['file_path']}")
        lines.append(f"  own subsystem: {c['own_subsystem']}")
        lines.append(f"  reaches:       {', '.join(c['reaches_subsystems'])}")
        lines.append(f"  KB trust tier: {c['trust_tier']}")
        lines.append(f"  predicted_confidence: {c.get('predicted_confidence', '?')}")
        pc = c.get("predicted_cascade")
        if pc:
            lines.append(
                f"  predicted cascade: {pc.get('forward_reach_depth2', 0)} files reached, "
                f"{pc.get('direct_callers', 0)} direct callers"
            )
        lines.append("")
    return "\n".join(lines)
