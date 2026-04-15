"""HME semantic drift reader — Phase 3.3 of openshell_features_to_mimic.md.

Renders `metrics/hme-semantic-drift.json` (populated by
`scripts/pipeline/check-kb-semantic-drift.py`) as a markdown digest. Surfaced
via `status(mode='drift')`.
"""
from __future__ import annotations

import json
import os

from server import context as ctx
from . import _track

REPORT_REL = os.path.join("metrics", "hme-semantic-drift.json")


def semantic_drift_report() -> str:
    _track("semantic_drift_report")
    path = os.path.join(ctx.PROJECT_ROOT, REPORT_REL)
    if not os.path.exists(path):
        return (
            "# KB Semantic Drift\n\n"
            "metrics/hme-semantic-drift.json not found.\n"
            "Run: python3 scripts/pipeline/check-kb-semantic-drift.py\n"
            "(Bootstrap baselines first with capture-kb-signatures.py)"
        )
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as _e:
        return f"# KB Semantic Drift\n\nCould not read: {type(_e).__name__}: {_e}"

    meta = data.get("meta", {}) or {}
    drifted = data.get("drifted_entries", []) or []

    lines = [
        "# KB Semantic Drift",
        "",
        f"Verified: {meta.get('verified', '?')}  of {meta.get('signatures_total', '?')} signatures",
        f"Drifted:  {meta.get('drifted', 0)}  (threshold: {meta.get('threshold', '?')} structural diffs)",
        "",
    ]

    if not drifted:
        lines.append("All captured entries still match their baseline structural signature.")
        lines.append("")
        lines.append("Distinct from staleness: drift says 'the module's relationships have")
        lines.append("shifted enough that the KB description is likely wrong', regardless of")
        lines.append("when the entry was last updated.")
        return "\n".join(lines)

    lines.append("## Drifted entries")
    for d in drifted[:30]:
        lines.append("")
        lines.append(
            f"### `{d.get('entry_id', '?')[:12]}` — {d.get('module', '?')}"
        )
        if d.get("kb_title"):
            lines.append(f"  title: {d['kb_title']}")
        lines.append(f"  file:  {d.get('file_path', '?')}")
        lines.append(f"  structural diffs: {d.get('structural_diff_count', 0)}")
        diffs = d.get("diffs") or []
        for diff in diffs[:6]:
            field = diff.get("field", "?")
            if "added" in diff or "removed" in diff:
                added = diff.get("added") or []
                removed = diff.get("removed") or []
                line = f"    - {field}"
                if added:
                    line += f"  +{added}"
                if removed:
                    line += f"  -{removed}"
                lines.append(line)
            elif "baseline" in diff and "current" in diff:
                lines.append(
                    f"    - {field}: {diff['baseline']} → {diff['current']}"
                    + (f" (Δ{diff['delta']:+d})" if "delta" in diff else "")
                )
    if len(drifted) > 30:
        lines.append("")
        lines.append(f"… and {len(drifted) - 30} more")
    return "\n".join(lines)
