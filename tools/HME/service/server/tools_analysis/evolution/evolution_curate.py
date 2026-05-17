"""Evolution strategies -- curate, contradict, adversarial stress.

Split from evolution_evolve.py. These are the heavy analysis functions
that each focus on a different evolution mode.
"""
import os
import re
import json
import logging

from server import context as ctx
from .. import _track, _budget_gate, BUDGET_COMPOUND, BUDGET_TOOL

logger = logging.getLogger("HME")




def _auto_curate() -> str:
    """Living memory curation: detect KB-worthy patterns from recent pipeline runs."""
    import json

    history_dir = os.path.join(ctx.PROJECT_ROOT, "src", "output", "metrics", "run-history")
    if not os.path.isdir(history_dir):
        return "# Auto-Curate\n\nNo run-history directory. Run pipeline first."

    history_files = sorted(
        [f for f in os.listdir(history_dir) if f.endswith(".json")],
        reverse=True,
    )
    if not history_files:
        return "# Auto-Curate\n\nNo pipeline runs found."

    runs = []
    for fname in history_files[:10]:
        try:
            with open(os.path.join(history_dir, fname), encoding="utf-8") as f:
                runs.append(json.load(f))
        except Exception as _err:
            logger.debug(f"unnamed-except evolution_evolve.py:250: {type(_err).__name__}: {_err}")
            continue

    if not runs:
        return "# Auto-Curate\n\nCouldn't load run history."

    latest = runs[0]
    feats = latest.get("features", {})

    kb_entries = ctx.project_engine.search_knowledge("", top_k=50)
    kb_text = " ".join(
        (e.get("title", "") + " " + e.get("content", "")[:200]).lower()
        for e in kb_entries
    )

    candidates: list[dict] = []

    # 1. Top trust system undocumented
    top_trust = feats.get("topTrustSystem", "")
    if top_trust and top_trust.lower() not in kb_text:
        candidates.append({
            "type": "trust_undocumented",
            "title": f"Top trust system: {top_trust}",
            "detail": f"#1 trust (weight={feats.get('topTrustWeight', '?')}) -- no KB entry",
            "category": "pattern",
            "draft": (
                f"{top_trust} is the current top trust system with weight "
                f"{feats.get('topTrustWeight', '?')}. Document its musical effect, "
                f"coupling relationships, and conditions that boost its trust."
            ),
        })

    # 2. Feature values at >2sigma from historical mean
    if len(runs) >= 3:
        tracked = [
            ("coherentShare", "Regime balance"), ("exploringShare", "Regime balance"),
            ("densityMean", "Texture"), ("pitchEntropy", "Texture"),
            ("healthScore", "Health"), ("exceedanceRate", "Health"),
            ("trustConvergence", "Trust"), ("tensionArcShape", "Form"),
        ]
        for key, domain in tracked:
            vals = [r.get("features", {}).get(key) for r in runs
                    if r.get("features", {}).get(key) is not None]
            if len(vals) < 3:
                continue
            curr = vals[0]
            hist = vals[1:]
            mean = sum(hist) / len(hist)
            std = (sum((v - mean) ** 2 for v in hist) / len(hist)) ** 0.5
            if std > 0.001 and abs(curr - mean) > 2 * std:
                direction = "spike" if curr > mean else "drop"
                candidates.append({
                    "type": "feature_extreme",
                    "title": f"{domain} {direction}: {key}={curr:.3f}",
                    "detail": f"Current {curr:.3f} vs mean {mean:.3f} +/-{std:.3f} (>2sigma)",
                    "category": "pattern",
                    "draft": (
                        f"{key} showed a significant {direction} to {curr:.3f} "
                        f"(historical mean {mean:.3f} +/-{std:.3f}). "
                        f"Investigate what changed and whether this is desirable."
                    ),
                })

    # 3. Verdict transition
    verdicts = [r.get("verdict") for r in runs if r.get("verdict")]
    if len(verdicts) >= 2 and verdicts[0] != verdicts[1]:
        transition = f"{verdicts[1]} -> {verdicts[0]}"
        candidates.append({
            "type": "verdict_shift",
            "title": f"Verdict transition: {transition}",
            "detail": "Pipeline verdict changed between last two runs",
            "category": "decision",
            "draft": (
                f"Verdict changed from {verdicts[1]} to {verdicts[0]}. "
                f"Document what changes drove this transition."
            ),
        })

    # 4. Coupling labels from trace-summary not in KB
    try:
        ts_path = os.path.join(ctx.PROJECT_ROOT, "src", "output", "metrics", "trace-summary.json")
        with open(ts_path, encoding="utf-8") as f:
            ts = json.load(f)
        labels = ts.get("couplingLabels", ts.get("aggregateCouplingLabels", {}))
        if isinstance(labels, dict):
            for label in labels:
                if label.lower() not in kb_text and len(label) > 3:
                    candidates.append({
                        "type": "coupling_undocumented",
                        "title": f"Coupling label: {label}",
                        "detail": "Active coupling pattern not documented in KB",
                        "category": "architecture",
                        "draft": (
                            f"The coupling label '{label}' is active but undocumented. "
                            f"Record which module pairs produce it and its musical effect."
                        ),
                    })
    except Exception as _err2:
        logger.debug(f'silent-except evolution_evolve.py:347: {type(_err2).__name__}: {_err2}')

    # 5. Section count change
    if len(runs) >= 2:
        curr_sc = feats.get("sectionCount", 0)
        prev_sc = runs[1].get("features", {}).get("sectionCount", 0)
        if curr_sc and prev_sc and curr_sc != prev_sc:
            candidates.append({
                "type": "structural_shift",
                "title": f"Section count: {prev_sc} -> {curr_sc}",
                "detail": "Composition structure changed between runs",
                "category": "pattern",
                "draft": (
                    f"Section count changed from {prev_sc} to {curr_sc}. "
                    f"Document what drove the structural shift."
                ),
            })

    # 6. Trust weight spread extremes
    spread = feats.get("trustWeightSpread")
    if spread is not None:
        if spread < 0.15:
            candidates.append({
                "type": "trust_monopoly",
                "title": f"Trust monopoly: spread={spread:.3f}",
                "detail": f"Top system {feats.get('topTrustSystem', '?')} dominates",
                "category": "pattern",
                "draft": (
                    f"Trust weight spread is only {spread:.3f} -- monopoly by "
                    f"{feats.get('topTrustSystem', '?')}. Document whether this "
                    f"concentration is desired or limiting musical diversity."
                ),
            })

    if not candidates:
        return "# Auto-Curate\n\nKB coverage is comprehensive -- no novel patterns in recent runs."

    parts = [f"# Auto-Curate: {len(candidates)} KB Candidates\n"]

    for i, c in enumerate(candidates, 1):
        parts.append(f"## {i}. [{c['type']}] {c['title']}")
        parts.append(f"  {c['detail']}")
        parts.append(f"  Category: {c['category']}")
        parts.append(f"  Draft: {c['draft']}")
        parts.append(f"  -> learn(title='{c['title'][:60]}...', content='...', category='{c['category']}')")
        parts.append("")

    from ..synthesis import _reasoning_think
    summary = "\n".join(f"- [{c['type']}] {c['title']}: {c['detail']}" for c in candidates[:6])
    synthesis = _reasoning_think(
        f"These patterns were detected in recent runs but aren't in the knowledge base:\n{summary}\n\n"
        "Which 1-2 are most important to document for maintaining compositional self-coherence? "
        "Answer in 2 sentences.",
        max_tokens=200,
        system="You are a music composition intelligence assistant. Be concise.",
    )
    if synthesis:
        parts.append(f"## Priority Recommendation\n{synthesis.strip()}")

    return "\n".join(parts)


