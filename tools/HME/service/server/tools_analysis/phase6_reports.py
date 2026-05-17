"""HME Phase 6 readers -- constitution / doc_drift / generalizations /
reflexivity. Thin markdown renderers.
"""
from __future__ import annotations

import json

from paths import hme_metric
from . import _track

CONSTITUTION_REL = "hme-constitution.json"
DOC_DRIFT_REL = "hme-doc-drift.json"
GENERALIZATIONS_REL = "hme-generalizations.json"
ACCURACY_REL = "hme-prediction-accuracy.json"


def _load(name: str):
    path = hme_metric(name)
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def constitution_report() -> str:
    _track("constitution_report")
    data = _load(CONSTITUTION_NAME)
    if not data:
        return (
            "# HME Constitution\n\n"
            "tools/HME/runtime/metrics/hme-constitution.json not found.\n"
            "Run: python3 tools/HME/scripts/pipeline/hme/derive-constitution.py"
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
        "Positive affirmations of what Polychron IS (not what it can't be --",
        "doc/templates/AGENTS.md covers prohibitions).",
        "",
    ]
    # Group by kind
    by_kind: dict[str, list[dict]] = {}
    for c in claims:
        by_kind.setdefault(c.get("kind", "?"), []).append(c)
    # Musical first: constitutional identity is what Polychron IS.
    for kind in ("musical", "methodological", "structural", "behavioral"):
        kc = by_kind.get(kind) or []
        if not kc:
            continue
        lines.append(f"## {kind.upper()} ({len(kc)})")
        for c in kc[:15]:
            lines.append(f"  ({c.get('confidence', 0):.2f}) {c.get('text', '?')[:140]}")
        if len(kc) > 15:
            lines.append(f"  ... and {len(kc) - 15} more")
        lines.append("")
    return "\n".join(lines)


def doc_drift_report() -> str:
    _track("doc_drift_report")
    data = _load(DOC_DRIFT_NAME)
    if not data:
        return (
            "# HME Doc Drift\n\n"
            "tools/HME/runtime/metrics/hme-doc-drift.json not found.\n"
            "Run: python3 tools/HME/scripts/pipeline/hme/detect-doc-drift.py"
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
        "claiming any doc change. v1 detector is deliberately noisy -- "
        "only backtick-fenced module-name tokens are checked, not prose."
    )
    return "\n".join(lines)


def reflexivity_report() -> str:
    """Phase 6.1 -- show how much of this round's prediction accuracy was
    contaminated by proxy injection vs clean post-hoc scoring."""
    _track("reflexivity_report")
    data = _load(ACCURACY_NAME)
    if not data:
        return (
            "# HME Reflexivity\n\n"
            "tools/HME/runtime/metrics/hme-prediction-accuracy.json not found yet."
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
        "## Clean bucket (post-hoc predictions -- true accuracy)",
        f"  predictions:  {clean.get('total', 0)}",
        f"  confirmed:    {clean.get('confirmed', 0)}",
        f"  refuted:      {clean.get('refuted', 0)}",
        f"  accuracy:     "
        f"{clean['accuracy'] * 100:.0f}%" if isinstance(clean.get("accuracy"), (int, float)) else "  accuracy:     n/a",
        "",
        "## Injected bucket (contaminated -- measures influence, not accuracy)",
        f"  predictions:  {injected.get('total', 0)}",
        f"  confirmed:    {injected.get('confirmed', 0)}",
        f"  refuted:      {injected.get('refuted', 0)}",
        f"  confirmation: "
        f"{injected['accuracy'] * 100:.0f}%" if isinstance(injected.get("accuracy"), (int, float)) else "  confirmation: n/a",
        "",
        "Rising clean-bucket accuracy = HME's causal model genuinely learning.",
        "High injected-bucket confirmation but flat clean-bucket accuracy = ",
        "HME is changing what the Evolver does without actually predicting",
        "better -- influence without understanding.",
    ]
    return "\n".join(lines)
