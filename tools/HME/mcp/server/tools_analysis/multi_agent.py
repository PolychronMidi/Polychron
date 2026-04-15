"""HME multi-agent observability scaffold — Phase 6.5.

HME can't unilaterally split the Evolver into Perceiver / Proposer /
Implementer agents — that's a process-level decision outside HME's
jurisdiction. What HME CAN do is provide the observability scaffold so
that IF the loop is run multi-agent, HME tracks inter-agent coherence
and can score whether the agents' outputs actually flow into each
other's inputs.

The scaffold:

  1. Activity events gain an optional `role` field (perceiver / proposer /
     implementer / single). Events without the field default to "single".
  2. Hypotheses + todos + KB entries gain an optional `agent_role` tag.
  3. This module computes inter-agent coherence:
       perceiver_to_proposer = % of proposer-role hypotheses that share
         tags with the most recent perceiver-role activity
       proposer_to_implementer = % of implementer-role file_written events
         that target a module mentioned in a proposer-role todo/hypothesis

  4. When all events in a round carry role=single, inter-agent coherence
     is N/A — single-agent operation isn't broken, it just can't be
     scored against the multi-agent ideal.

Surfaced via status(mode='multi_agent').

This is v1 scaffolding. Actual multi-agent operation is a future project
decision; HME is ready when that decision gets made.
"""
from __future__ import annotations

import json
import os

from server import context as ctx
from . import _track

ACTIVITY_REL = os.path.join("metrics", "hme-activity.jsonl")
HYPOTHESES_REL = os.path.join("metrics", "hme-hypotheses.json")
OUT_REL = os.path.join("metrics", "hme-inter-agent-coherence.json")


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


def _round_events() -> list[dict]:
    events = _read_events()
    # Slice to current round
    last = -1
    for i in range(len(events) - 1, -1, -1):
        if events[i].get("event") == "round_complete":
            last = i
            break
    return events[last + 1 :] if last >= 0 else events


def compute_inter_agent_coherence() -> dict:
    _track("multi_agent")
    events = _round_events()
    hypotheses_data = _load(HYPOTHESES_REL) or {}
    hypotheses = hypotheses_data.get("hypotheses", []) or []

    # Role distribution in this round
    role_counts: dict[str, int] = {}
    for ev in events:
        role = ev.get("role", "single")
        role_counts[role] = role_counts.get(role, 0) + 1
    total = sum(role_counts.values())
    multi_agent_active = bool(
        role_counts.get("perceiver") or role_counts.get("proposer") or role_counts.get("implementer")
    )

    # Perceiver events — tag-like tokens in their module/file fields
    perceiver_modules: set[str] = set()
    for ev in events:
        if ev.get("role") != "perceiver":
            continue
        if ev.get("module"):
            perceiver_modules.add(ev["module"])

    proposer_hypotheses = [
        h for h in hypotheses if h.get("agent_role") == "proposer"
    ]
    # perceiver_to_proposer: fraction of proposer hypotheses that mention
    # at least one perceiver module in their `modules` list
    perc_to_prop_linked = 0
    for h in proposer_hypotheses:
        hm = set(h.get("modules") or [])
        if hm & perceiver_modules:
            perc_to_prop_linked += 1
    perc_to_prop = (
        perc_to_prop_linked / len(proposer_hypotheses) if proposer_hypotheses else None
    )

    # proposer_to_implementer: fraction of implementer-role file_written
    # events whose module appears in any proposer hypothesis
    proposer_modules: set[str] = set()
    for h in proposer_hypotheses:
        for m in h.get("modules") or []:
            proposer_modules.add(m)
    implementer_writes = [
        ev for ev in events
        if ev.get("role") == "implementer" and ev.get("event") == "file_written"
    ]
    prop_to_impl_linked = sum(
        1 for ev in implementer_writes if ev.get("module") in proposer_modules
    )
    prop_to_impl = (
        prop_to_impl_linked / len(implementer_writes) if implementer_writes else None
    )

    report = {
        "meta": {
            "multi_agent_active": multi_agent_active,
            "total_events_in_round": total,
            "role_counts": role_counts,
            "proposer_hypotheses": len(proposer_hypotheses),
            "implementer_writes": len(implementer_writes),
        },
        "inter_agent_coherence": {
            "perceiver_to_proposer": None
            if perc_to_prop is None
            else round(perc_to_prop, 4),
            "proposer_to_implementer": None
            if prop_to_impl is None
            else round(prop_to_impl, 4),
        },
    }

    out_path = os.path.join(ctx.PROJECT_ROOT, OUT_REL)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    return report


def multi_agent_report() -> str:
    _track("multi_agent_report")
    report = compute_inter_agent_coherence()
    meta = report["meta"]
    coh = report["inter_agent_coherence"]
    lines = [
        "# HME Multi-Agent Coherence",
        "",
        f"**Multi-agent active:** {meta['multi_agent_active']}",
        f"Round events total: {meta['total_events_in_round']}",
        "",
        "## Role distribution (current round)",
    ]
    for role, count in sorted(meta["role_counts"].items(), key=lambda x: -x[1]):
        lines.append(f"  {role:<15} {count}")
    if not meta["multi_agent_active"]:
        lines.append("")
        lines.append(
            "Operating in single-agent mode (all events role=single). "
            "Multi-agent coherence scoring is N/A."
        )
        lines.append("")
        lines.append(
            "To enable role tagging, pass `role=...` on activity emit calls "
            "and `agent_role=...` on hypothesis/todo records."
        )
        return "\n".join(lines)

    lines.append("")
    lines.append("## Inter-agent coherence")
    p2p = coh["perceiver_to_proposer"]
    pr2i = coh["proposer_to_implementer"]
    lines.append(
        f"  perceiver → proposer:    "
        f"{f'{p2p * 100:.0f}%' if isinstance(p2p, (int, float)) else 'n/a'}  "
        f"({meta['proposer_hypotheses']} proposer hypotheses)"
    )
    lines.append(
        f"  proposer → implementer:  "
        f"{f'{pr2i * 100:.0f}%' if isinstance(pr2i, (int, float)) else 'n/a'}  "
        f"({meta['implementer_writes']} implementer writes)"
    )
    return "\n".join(lines)
