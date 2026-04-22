#!/usr/bin/env python3
"""Phase 6.2 — HME constitutional identity layer.

Derives positive identity claims about Polychron from:
  1. Crystallized patterns with strong multi-round evidence (≥4 rounds)
  2. Human ground-truth entries with compelling/surprising sentiment
  3. Feedback graph loops and firewall ports (structural invariants)

Each claim has an evidence trail so the proxy can cite it when
flagging identity-risk proposals. Rule-based extraction — no LLM
synthesis in v1. The rules are deliberately conservative: only very
strong evidence promotes a claim, so the constitution reflects what
the system has become, not what any single round tried.

Distinct from CLAUDE.md's hard rules:
  - CLAUDE.md says what Polychron can't be (prohibitions)
  - hme-constitution.json says what Polychron fundamentally IS (affirmations)

Output: metrics/hme-constitution.json with claims array, each with:
  - id, text, evidence: {rounds, patterns, ground_truth_ids}
  - confidence (0..1 derived from evidence breadth)
  - kind: structural | behavioral | musical | methodological

Surfaced via status(mode='constitution').

Runs as POST_COMPOSITION; rebuilds the constitution on every pipeline.
"""
from __future__ import annotations

import json
import os
import sys
import time

PROJECT_ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get(
METRICS_DIR = os.path.join(PROJECT_ROOT, "output", "metrics")
    "PROJECT_ROOT", "/home/jah/Polychron"
)
CRYSTALLIZED_PATH = os.path.join(METRICS_DIR, "hme-crystallized.json")
GROUND_TRUTH_LOG = os.path.join(METRICS_DIR, "hme-ground-truth.jsonl")
FEEDBACK_GRAPH = os.path.join(METRICS_DIR, "feedback_graph.json")
OUT_PATH = os.path.join(METRICS_DIR, "hme-constitution.json")

MIN_PATTERN_ROUNDS = int(os.environ.get("HME_CONSTITUTION_MIN_PATTERN_ROUNDS", "4"))
MIN_PATTERN_MEMBERS = int(os.environ.get("HME_CONSTITUTION_MIN_PATTERN_MEMBERS", "3"))


def _load_json(path: str):
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, ValueError, TypeError):
        return None


def _load_ground_truth_stream() -> list[dict]:
    if not os.path.exists(GROUND_TRUTH_LOG):
        return []
    out: list[dict] = []
    with open(GROUND_TRUTH_LOG, encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


POSITIVE_SENTIMENTS = {"compelling", "surprising", "moving"}


def extract_claims_from_patterns(patterns: list[dict]) -> list[dict]:
    """Patterns with strong multi-round evidence become structural/
    methodological claims."""
    out: list[dict] = []
    for p in patterns:
        rounds = p.get("rounds") or []
        members = p.get("member_ids") or []
        if len(rounds) < MIN_PATTERN_ROUNDS or len(members) < MIN_PATTERN_MEMBERS:
            continue
        tags = p.get("shared_tags") or []
        seed = p.get("seed_tag") or (tags[0] if tags else "unknown")
        synth = (p.get("synthesis") or "").strip()
        # Evidence breadth → confidence
        confidence = min(1.0, (len(rounds) / 10.0) + (len(members) / 10.0))
        claim_text = (
            f"`{seed}` has established itself as an architectural fixture: "
            f"{synth[:160] or '(no synthesis available)'}"
        )
        out.append({
            "id": f"const_pattern_{seed}",
            "text": claim_text,
            "kind": "methodological",
            "confidence": round(confidence, 3),
            "evidence": {
                "pattern_id": p.get("id", "?"),
                "rounds": rounds,
                "member_count": len(members),
                "shared_tags": tags,
            },
        })
    return out


def extract_claims_from_ground_truth(gt_stream: list[dict]) -> list[dict]:
    """Human ground truth entries in positive sentiment buckets, grouped
    by (section, moment_type), become musical identity claims."""
    from collections import defaultdict
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in gt_stream:
        sent = (r.get("sentiment") or "").lower()
        if sent not in POSITIVE_SENTIMENTS:
            continue
        section = r.get("section") or "?"
        moment = r.get("moment_type") or "?"
        grouped[(section, moment)].append(r)

    out: list[dict] = []
    for (section, moment), records in grouped.items():
        if len(records) < 1:  # v1: even one positive record promotes
            continue
        sample_comment = (records[-1].get("comment") or "").strip()
        confidence = min(1.0, len(records) / 3.0)
        out.append({
            "id": f"const_music_{section}_{moment}",
            "text": (
                f"In {section}, {moment} moments register as compelling to "
                f"human listeners — {sample_comment[:140] or '(no comment)'}"
            ),
            "kind": "musical",
            "confidence": round(confidence, 3),
            "evidence": {
                "records": len(records),
                "rounds": sorted({r.get("round_tag", "?") for r in records if r.get("round_tag")}),
                "ground_truth_ids": [r.get("ts") for r in records],
            },
        })
    return out


def extract_claims_from_pipeline() -> list[dict]:
    """Pipeline observability contract — what events must fire, what files
    must be written, what order they come in. These are structural invariants
    of the system's own instrumentation; they belong in the constitution
    alongside feedback loops.

    Every pipeline run is contractually obligated to produce:
      - pipeline_start activity event at launch
      - pipeline_run activity event at finish (with verdict + hci)
      - round_complete activity event at finish (with verdict)
      - metrics/pipeline-summary.json with verdict, hci, wallTimeSeconds
      - metrics/fingerprint-comparison.json with verdict

    Surfacing these as constitutional claims makes them visible in
    status(mode='constitution') and protected by the invariants in
    config/invariants.json (pipeline-start-end-balanced, etc.).
    """
    out: list[dict] = []
    contract = [
        ("pipeline_emits_start",
         "Every pipeline run emits exactly one `pipeline_start` activity event at launch — agent-independent via main-pipeline.js"),
        ("pipeline_emits_run",
         "Every pipeline run emits exactly one `pipeline_run` activity event at finish, carrying verdict + hci — agent-independent"),
        ("pipeline_emits_round_complete",
         "Every pipeline run emits exactly one `round_complete` activity event at finish, carrying verdict (distinguishes it from chat-turn markers)"),
        ("pipeline_writes_summary",
         "Every pipeline run writes metrics/pipeline-summary.json with verdict + hci + wallTimeSeconds + per-step ok flags"),
        ("pipeline_writes_fingerprint",
         "Every pipeline run writes metrics/fingerprint-comparison.json with the musical verdict (STABLE/EVOLVED/DRIFTED)"),
        ("pipeline_spawns_analytics",
         "Every pipeline run spawns 9 background analytics scripts (holograph, dashboard, chain-snapshot, trajectory, tool-effectiveness, coupling matrix, hci-signal, verifier-coverage, memetic-drift)"),
    ]
    for claim_id, text in contract:
        out.append({
            "id": f"const_pipeline_{claim_id}",
            "text": text,
            "kind": "structural",
            "confidence": 1.0,
            "evidence": {
                "source": "scripts/pipeline/main-pipeline.js",
                "claim_id": claim_id,
            },
        })
    return out


def extract_claims_from_feedback_graph() -> list[dict]:
    """Feedback loops + firewall ports are structural invariants. Any
    loop present in the graph is constitutional — the system REQUIRES it."""
    fb = _load_json(FEEDBACK_GRAPH) or {}
    loops = fb.get("feedbackLoops", []) or []
    ports = fb.get("firewallPorts", []) or []
    out: list[dict] = []
    for loop in loops:
        loop_id = loop.get("id", "?")
        desc = (loop.get("description") or "").strip()
        out.append({
            "id": f"const_loop_{loop_id}",
            "text": f"Feedback loop `{loop_id}` is structural: {desc[:160]}",
            "kind": "structural",
            "confidence": 1.0,
            "evidence": {
                "loop_id": loop_id,
                "source": os.path.join(METRICS_DIR, "feedback_graph.json"),
            },
        })
    for port in ports:
        port_id = port.get("id", "?")
        desc = (port.get("description") or "").strip()
        out.append({
            "id": f"const_port_{port_id}",
            "text": f"Firewall port `{port_id}` is a declared cross-boundary opening: {desc[:160]}",
            "kind": "structural",
            "confidence": 1.0,
            "evidence": {
                "port_id": port_id,
                "source": os.path.join(METRICS_DIR, "feedback_graph.json"),
            },
        })
    return out


def main() -> int:
    crystallized = _load_json(CRYSTALLIZED_PATH) or {}
    patterns = crystallized.get("patterns") or []

    gt_stream = _load_ground_truth_stream()

    claims: list[dict] = []
    claims.extend(extract_claims_from_patterns(patterns))
    claims.extend(extract_claims_from_ground_truth(gt_stream))
    claims.extend(extract_claims_from_feedback_graph())
    claims.extend(extract_claims_from_pipeline())

    # Sort by kind then confidence descending. Musical claims come first
    # because Polychron's constitutional identity is what it IS (a music
    # composition system), not what holds it together (feedback loops,
    # firewall ports). Structural claims are prerequisites, not the identity.
    # Previous ordering put structural first which flattened musical identity
    # into a footnote — an inverted priority that shaped every downstream
    # self-model (crystallizer, self_audit, trust weights) toward structure
    # over sound.
    kind_order = {"musical": 0, "methodological": 1, "structural": 2, "behavioral": 3}
    claims.sort(key=lambda c: (kind_order.get(c["kind"], 99), -c.get("confidence", 0)))

    by_kind: dict[str, int] = {}
    for c in claims:
        by_kind[c["kind"]] = by_kind.get(c["kind"], 0) + 1

    report = {
        "meta": {
            "script": "derive-constitution.py",
            "timestamp": int(time.time()),
            "claim_count": len(claims),
            "by_kind": by_kind,
            "source_patterns": len(patterns),
            "source_ground_truth": len(gt_stream),
        },
        "claims": claims,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print(
        f"derive-constitution: {len(claims)} claim(s) — "
        f"{by_kind}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
