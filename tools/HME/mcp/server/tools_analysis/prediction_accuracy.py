"""HME prediction accuracy reader — Phase 3.4 of openshell_features_to_mimic.md.

Renders `metrics/hme-prediction-accuracy.json` (populated by
`scripts/pipeline/reconcile-predictions.js`) as a markdown digest.
Surfaced via `status(mode='accuracy')`.
"""
from __future__ import annotations

import json
import os

from server import context as ctx
from . import _track

REPORT_REL = os.path.join("output", "metrics", "hme-prediction-accuracy.json")


def prediction_accuracy_report() -> str:
    _track("prediction_accuracy_report")
    path = os.path.join(ctx.PROJECT_ROOT, REPORT_REL)
    if not os.path.exists(path):
        return (
            "# HME Prediction Accuracy\n\n"
            os.path.join(METRICS_DIR, "hme-prediction-accuracy.json not found.\n")
            "Runs automatically as a post-composition step "
            "(`reconcile-predictions.js`). Invoke "
            "`trace(target='moduleName', mode='impact')` during a session to "
            "generate predictions the reconciler can score."
        )
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as _e:
        return f"# HME Prediction Accuracy\n\nCould not read: {type(_e).__name__}: {_e}"

    rounds = data.get("rounds", []) or []
    ema = data.get("ema")
    ema_s = f"{ema * 100:.1f}%" if isinstance(ema, (int, float)) else "n/a"

    lines = [
        "# HME Prediction Accuracy",
        "",
        f"**EMA:** {ema_s}  ({len(rounds)} round(s) recorded, α={data.get('meta', {}).get('ema_alpha', '?')})",
        "",
    ]

    if not rounds:
        lines.append("No rounds reconciled yet. Issue cascade predictions first.")
        return "\n".join(lines)

    # Show the last 10 rounds
    lines.append("## Recent rounds")
    lines.append("")
    lines.append("| Round | Acc | EMA | Predicted | Confirmed | Refuted | Missed |")
    lines.append("-")
    for r in rounds[-10:]:
        acc = r.get("accuracy")
        acc_s = f"{acc * 100:.0f}%" if isinstance(acc, (int, float)) else "n/a"
        ema_r = r.get("ema_after")
        ema_rs = f"{ema_r * 100:.0f}%" if isinstance(ema_r, (int, float)) else "n/a"
        ts = r.get("timestamp", "?")
        tail = ts[-19:-5] if isinstance(ts, str) and len(ts) >= 19 else ts
        lines.append(
            f"| {tail} | {acc_s} | {ema_rs} | "
            f"{len(r.get('predicted_modules') or [])} | "
            f"{len(r.get('confirmed') or [])} | "
            f"{len(r.get('refuted') or [])} | "
            f"{len(r.get('missed') or [])} |"
        )

    # Most recent round — show specifics
    latest = rounds[-1]
    lines.append("")
    lines.append("## Latest round detail")
    conf = latest.get("confirmed") or []
    ref = latest.get("refuted") or []
    miss = latest.get("missed") or []
    if conf:
        lines.append(f"  ✓ confirmed: {', '.join(conf[:15])}" + (f" (+{len(conf)-15})" if len(conf) > 15 else ""))
    if ref:
        lines.append(f"  ✗ refuted:   {', '.join(ref[:15])}" + (f" (+{len(ref)-15})" if len(ref) > 15 else ""))
    if miss:
        lines.append(f"  ? missed:    {', '.join(miss[:15])}" + (f" (+{len(miss)-15})" if len(miss) > 15 else ""))

    lines.append("")
    lines.append("Interpretation: EMA rising = HME's causal model is learning.")
    lines.append("EMA falling = predictions diverging from reality — KB likely wrong.")
    return "\n".join(lines)
