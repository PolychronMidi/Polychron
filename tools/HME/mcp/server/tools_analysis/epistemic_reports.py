"""HME epistemic status readers — Phase 4 of openshell_features_to_mimic.md.

Thin markdown renderers for the three JSON files produced by Phase 4
pipeline scripts:

  - metrics/hme-musical-correlation.json  → music_truth_report()
  - metrics/kb-trust-weights.json         → kb_trust_report()
  - metrics/hme-intention-gap.json        → intention_gap_report()

Surfaced via status(mode='music_truth' | 'kb_trust' | 'intention_gap').
Reading-only; no computation here beyond formatting.
"""
from __future__ import annotations

import json
import os

from server import context as ctx
from . import _track

MUSICAL_REL = os.path.join("output", "metrics", "hme-musical-correlation.json")
TRUST_REL = os.path.join("output", "metrics", "kb-trust-weights.json")
GAP_REL = os.path.join("output", "metrics", "hme-intention-gap.json")


def _load(rel: str):
    path = os.path.join(ctx.PROJECT_ROOT, rel)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def music_truth_report() -> str:
    _track("music_truth_report")
    data = _load(MUSICAL_REL)
    if not data:
        return (
            "# HME Musical Ground Truth\n\n"
            "output/metrics/hme-musical-correlation.json not found.\n"
            "Runs automatically post-composition "
            "(`scripts/pipeline/compute-musical-correlation.js`)."
        )
    latest = data.get("latest") or {}
    corr = data.get("correlations") or {}
    strongest = data.get("strongest_correlation")
    warning = data.get("warning")
    meta = data.get("meta") or {}

    lines = [
        "# HME Musical Ground Truth",
        "",
        f"History: {meta.get('history_length', 0)} round(s)  "
        f"window={meta.get('rolling_window', '?')}",
        "",
        "## Latest snapshot",
    ]
    for k in (
        "hme_coherence",
        "hme_prediction_accuracy",
        "fingerprint_verdict",
        "perceptual_complexity_avg",
        "clap_tension",
        "encodec_entropy_avg",
    ):
        v = latest.get(k)
        if isinstance(v, (int, float)):
            lines.append(f"  {k:<30} {v:.3f}")
        elif v is not None:
            lines.append(f"  {k:<30} {v}")

    if corr:
        lines.append("")
        lines.append("## Rolling-window correlations (Pearson r)")
        # Split so non-degenerate correlations lead the list — they're the
        # scientifically meaningful ones. Degenerate pairs (too few distinct
        # values in x or y, n<3, etc.) get collapsed to a summary at the
        # bottom. Previously a 20-pair list was 17 degenerates drowning out
        # 3 real correlations.
        computable = []
        degenerate_items = []
        for k, c in corr.items():
            if c.get("degenerate"):
                degenerate_items.append((k, c))
            else:
                computable.append((k, c))
        # Sort computable by |r| desc so strongest correlations lead.
        computable.sort(key=lambda kc: -abs(kc[1].get("r", 0) if isinstance(kc[1].get("r"), (int, float)) else 0))
        for k, c in computable:
            r = c.get("r")
            n = c.get("n", 0)
            r_s = f"{r:+.3f}" if isinstance(r, (int, float)) else "n/a"
            lines.append(f"  {k:<55} r={r_s}  n={n}")
        if degenerate_items:
            lines.append("")
            lines.append(f"  ── {len(degenerate_items)} degenerate pair(s) suppressed ──")
            for k, c in degenerate_items[:3]:
                reason = c.get("reason", "")
                lines.append(f"     {k}  ({reason})")
            if len(degenerate_items) > 3:
                lines.append(f"     …and {len(degenerate_items) - 3} more")

    if strongest is not None:
        lines.append("")
        lines.append(f"**Strongest correlation:** r={strongest:.3f}")

    if warning:
        lines.append("")
        lines.append(f"⚠ {warning}")

    return "\n".join(lines)


def kb_trust_report() -> str:
    _track("kb_trust_report")
    data = _load(TRUST_REL)
    if not data:
        return (
            "# KB Trust Weights\n\n"
            "output/metrics/kb-trust-weights.json not found.\n"
            "Runs automatically post-composition "
            "(`scripts/pipeline/compute-kb-trust-weights.py`)."
        )
    meta = data.get("meta") or {}
    entries = data.get("entries") or {}
    tiers = meta.get("tier_counts") or {}
    lines = [
        "# KB Trust Weights",
        "",
        f"Formula: `{meta.get('formula', '?')}`",
        f"Total entries: {meta.get('entries_total', 0)}",
        "",
        "## Tier distribution",
        f"  HIGH  {tiers.get('HIGH', 0)}",
        f"  MED   {tiers.get('MED', 0)}",
        f"  LOW   {tiers.get('LOW', 0)}",
        "",
    ]
    # Top-trust and lowest-trust samples
    sorted_entries = sorted(
        entries.values(), key=lambda e: e.get("trust", 0), reverse=True
    )
    if sorted_entries:
        lines.append("## Top-trust entries")
        for e in sorted_entries[:5]:
            lines.append(f"  {e.get('trust', 0):.3f} [{e.get('tier', '?')}] {e.get('title', '?')[:80]}")
        lines.append("")
        lines.append("## Lowest-trust entries")
        for e in sorted_entries[-5:]:
            lines.append(f"  {e.get('trust', 0):.3f} [{e.get('tier', '?')}] {e.get('title', '?')[:80]}")
    return "\n".join(lines)


def intention_gap_report() -> str:
    _track("intention_gap_report")
    data = _load(GAP_REL)
    if not data:
        return (
            "# HME Intention-Execution Gap\n\n"
            "output/metrics/hme-intention-gap.json not found.\n"
            "Runs automatically post-composition "
            "(`scripts/pipeline/compute-intention-gap.js`)."
        )
    latest = data.get("latest") or {}
    ema = data.get("ema")
    history = data.get("history") or []
    lines = [
        "# HME Intention-Execution Gap",
        "",
        f"EMA: {ema * 100:.1f}%" if isinstance(ema, (int, float)) else "EMA: n/a",
        f"History: {len(history)} round(s)",
        "",
        "## Latest round",
    ]
    for k in (
        "todos_total",
        "trackable",
        "fully_executed",
        "partially_executed",
        "abandoned",
        "untrackable",
    ):
        lines.append(f"  {k:<22} {latest.get(k, 0)}")
    gap = latest.get("gap")
    if isinstance(gap, (int, float)):
        lines.append(f"  gap                    {gap * 100:.0f}%")

    # Explain "untrackable" — previously users saw a high count with no idea
    # what it meant. A todo is untrackable when its text doesn't mention any
    # expected-artifact pattern the gap-computer knows how to verify
    # (file paths, module names, git-log tokens, etc.). They're not failures;
    # they're just outside the current telemetry's introspection range.
    n_untrackable = latest.get("untrackable", 0)
    n_total = latest.get("todos_total", 0)
    if n_untrackable and n_total:
        lines.append("")
        lines.append(
            f"  note: {n_untrackable}/{n_total} todos are UNTRACKABLE — their text "
            f"doesn't match any artifact pattern the gap-computer can verify "
            f"(file paths, module names, commit tokens). Not failures; just "
            f"outside introspection range. See scripts/pipeline/compute-intention-gap.js "
            f"to extend the patterns."
        )

    abandoned = latest.get("abandoned_items") or []
    if abandoned:
        lines.append("")
        lines.append("## Abandoned items (top 5)")
        for a in abandoned[:5]:
            exp = a.get("expected") or []
            lines.append(f"  #{a.get('id', '?')} {a.get('text', '')[:60]}")
            if exp:
                lines.append(f"    expected: {', '.join(str(x) for x in exp[:3])}")
    return "\n".join(lines)
