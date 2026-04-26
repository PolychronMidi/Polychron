"""HME Phase 6 readers — constitution / doc_drift / generalizations /
reflexivity. Thin markdown renderers.
"""
from __future__ import annotations

import json
import os

from server import context as ctx
from . import _track

CONSTITUTION_REL = os.path.join("output", "metrics", "hme-constitution.json")
DOC_DRIFT_REL = os.path.join("output", "metrics", "hme-doc-drift.json")
GENERALIZATIONS_REL = os.path.join("output", "metrics", "hme-generalizations.json")
ACCURACY_REL = os.path.join("output", "metrics", "hme-prediction-accuracy.json")


def _load(rel: str):
    path = os.path.join(ctx.PROJECT_ROOT, rel)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def constitution_report() -> str:
    _track("constitution_report")
    data = _load(CONSTITUTION_REL)
    if not data:
        return (
            "# HME Constitution\n\n"
            "output/metrics/hme-constitution.json not found.\n"
            "Run: python3 scripts/pipeline/derive-constitution.py"
        )
    meta = data.get("meta", {}) or {}
    claims = data.get("claims", []) or []
    lines = [
        "# HME Constitution",
        "",
        f"**Claim count:** {meta.get('claim_count', 0)}  by kind: {meta.get('by_kind', {})}",
        f"Source: {meta.get('source_patterns', 0)} crystallized patterns, "
        f"{meta.get('source_ground_truth', 0)} ground-truth entries",
        "",
        "Positive affirmations of what Polychron IS (not what it can't be —",
        "CLAUDE.md covers prohibitions).",
        "",
    ]
    # Group by kind
    by_kind: dict[str, list[dict]] = {}
    for c in claims:
        by_kind.setdefault(c.get("kind", "?"), []).append(c)
    # Musical first: constitutional identity is what Polychron IS.
    # Structural claims come later — they hold the identity in place but aren't
    # the identity itself. See derive-constitution.py for the ordering rationale.
    for kind in ("musical", "methodological", "structural", "behavioral"):
        kc = by_kind.get(kind) or []
        if not kc:
            continue
        lines.append(f"## {kind.upper()} ({len(kc)})")
        for c in kc[:15]:
            lines.append(f"  ({c.get('confidence', 0):.2f}) {c.get('text', '?')[:140]}")
        if len(kc) > 15:
            lines.append(f"  … and {len(kc) - 15} more")
        lines.append("")
    return "\n".join(lines)


def doc_drift_report() -> str:
    _track("doc_drift_report")
    data = _load(DOC_DRIFT_REL)
    if not data:
        return (
            "# HME Doc Drift\n\n"
            "output/metrics/hme-doc-drift.json not found.\n"
            "Run: python3 scripts/pipeline/detect-doc-drift.py"
        )
    meta = data.get("meta", {}) or {}
    docs = data.get("docs", {}) or {}
    rule_notes = data.get("rule_notes") or []
    lines = [
        "# HME Doc Drift",
        "",
        f"Source modules:         {meta.get('source_modules', 0)}",
        f"KB referenced modules:  {meta.get('kb_referenced_modules', 0)}",
        f"KB orphaned references: {meta.get('kb_orphans', 0)}",
        "",
        "## Per-doc orphaned backtick references",
    ]
    for doc_path, info in docs.items():
        lines.append(
            f"  {doc_path:<30} {info.get('orphaned_count', 0):>4} orphans of "
            f"{info.get('mentioned', 0)} mentioned"
        )
        samples = info.get("orphaned_refs") or []
        if samples[:5]:
            lines.append(f"    sample: {', '.join(samples[:5])}")
    if rule_notes:
        lines.append("")
        lines.append("## Rule usage notes")
        for note in rule_notes:
            lines.append(f"  [{note.get('kind', '?')}] {note.get('message', '')}")
    lines.append("")
    lines.append(
        "These are DETECTION signals only. Human review required before "
        "claiming any doc change. v1 detector is deliberately noisy — "
        "only backtick-fenced module-name tokens are checked, not prose."
    )
    return "\n".join(lines)


def generalizations_report() -> str:
    _track("generalizations_report")
    data = _load(GENERALIZATIONS_REL)
    if not data:
        return (
            "# HME Generalizations\n\n"
            "output/metrics/hme-generalizations.json not found.\n"
            "Run: python3 scripts/pipeline/extract-generalizations.py"
        )
    meta = data.get("meta", {}) or {}
    candidates = data.get("candidates", []) or []
    lines = [
        "# HME Generalizations",
        "",
        f"Scanned {meta.get('patterns_scanned', 0)} crystallized patterns",
        f"Candidates below specificity {meta.get('specificity_threshold', '?')}: "
        f"{len(candidates)}",
        "",
        "Patterns that might generalize beyond Polychron — these go through",
        "synthesize-generalizations → `hme-discoveries-draft.jsonl` → human promotion",
        "via `learn(action='promote_discovery')` → `doc/hme-discoveries.md`.",
        "",
    ]
    for c in candidates[:15]:
        lines.append(
            f"  [{c['specificity']:.2f}]  {c['pattern_id']}  "
            f"({c['member_count']} members, {len(c['rounds'])} rounds)"
        )
        tags = c.get("shared_tags") or []
        if tags:
            lines.append(f"    tags: {', '.join(tags[:6])}")
    return "\n".join(lines)


def reflexivity_report() -> str:
    """Phase 6.1 — show how much of this round's prediction accuracy was
    contaminated by proxy injection vs clean post-hoc scoring."""
    _track("reflexivity_report")
    data = _load(ACCURACY_REL)
    if not data:
        return (
            "# HME Reflexivity\n\n"
            "output/metrics/hme-prediction-accuracy.json not found yet."
        )
    rounds = data.get("rounds") or []
    if not rounds:
        return "# HME Reflexivity\n\nNo rounds reconciled yet."
    latest = rounds[-1]
    clean = latest.get("clean_bucket") or {}
    injected = latest.get("injected_bucket") or {}
    lines = [
        "# HME Reflexivity",
        "",
        "Prediction accuracy split by provenance: were the predicted modules",
        "surfaced to the Evolver via proxy injection BEFORE the edit (influence)",
        "or produced post-hoc as a clean test of the cascade model (accuracy)?",
        "",
        f"**Reflexivity ratio:** {latest.get('reflexivity_ratio', 0) * 100:.0f}%  "
        f"(fraction of predictions that were injected)",
        "",
        "## Clean bucket (post-hoc predictions — true accuracy)",
        f"  predictions:  {clean.get('total', 0)}",
        f"  confirmed:    {clean.get('confirmed', 0)}",
        f"  refuted:      {clean.get('refuted', 0)}",
        f"  accuracy:     "
        f"{clean['accuracy'] * 100:.0f}%" if isinstance(clean.get("accuracy"), (int, float)) else "  accuracy:     n/a",
        "",
        "## Injected bucket (contaminated — measures influence, not accuracy)",
        f"  predictions:  {injected.get('total', 0)}",
        f"  confirmed:    {injected.get('confirmed', 0)}",
        f"  refuted:      {injected.get('refuted', 0)}",
        f"  confirmation: "
        f"{injected['accuracy'] * 100:.0f}%" if isinstance(injected.get("accuracy"), (int, float)) else "  confirmation: n/a",
        "",
        "Rising clean-bucket accuracy = HME's causal model genuinely learning.",
        "High injected-bucket confirmation but flat clean-bucket accuracy = ",
        "HME is changing what the Evolver does without actually predicting",
        "better — influence without understanding.",
    ]
    return "\n".join(lines)
