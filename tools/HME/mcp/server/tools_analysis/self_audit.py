"""HME self-audit — Phase 4.4 of openshell_features_to_mimic.md.

The first four phases gave HME the ability to model the system. This
module gives HME the ability to model its own *utility*: which of its
components fire frequently but don't influence the Evolver's next action,
which KB categories accumulate entries but never get queried, which
injections land but the agent ignores them.

Data sources (all read-only, all already generated elsewhere):

  tools/HME/KB/knowledge_access.json  per-entry retrieval counts
  metrics/hme-activity.jsonl             hook and proxy events
  metrics/hme-prediction-accuracy.json   cascade prediction outcomes

The audit looks for three structural inefficiencies:

  1. **Unused KB categories** — >15 entries in a category with zero total
     retrievals, or retrieval count < entries/10
  2. **Silent injections** — proxy jurisdiction_inject events with no
     subsequent mcp__HME__read tool call in the same session
  3. **Cascade overconfidence** — prediction accuracy EMA below 0.5 on
     modules where the cascade has been invoked >3 times

Surfaced via `status(mode='self_audit')`. Non-destructive — reports
inefficiencies as self-evolution *candidates*, never modifies anything.
"""
from __future__ import annotations

import json
import os
from collections import Counter

from server import context as ctx
from . import _track

KNOWLEDGE_ACCESS_REL = os.path.join("tools", "HME", "KB", "knowledge_access.json")
ACTIVITY_REL = os.path.join("metrics", "hme-activity.jsonl")
ACCURACY_REL = os.path.join("metrics", "hme-prediction-accuracy.json")
CORRELATION_REL = os.path.join("metrics", "hme-musical-correlation.json")


def _load_json(rel: str):
    path = os.path.join(ctx.PROJECT_ROOT, rel)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _load_events(lookback: int = 2000) -> list[dict]:
    path = os.path.join(ctx.PROJECT_ROOT, ACTIVITY_REL)
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()[-lookback:]
    out: list[dict] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _load_kb_entries() -> list[dict]:
    try:
        import lancedb  # noqa: WPS433
    except ImportError:
        return []
    try:
        db = lancedb.connect(os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "KB"))
        tbl = db.open_table("knowledge")
        df = tbl.to_pandas()
    except Exception as _e:  # noqa: BLE001
        import logging
        logging.getLogger("HME").debug(f"self_audit KB read failed: {_e}")
        return []
    out: list[dict] = []
    for _, row in df.iterrows():
        out.append({
            "id": str(row.get("id", "")),
            "category": str(row.get("category", "general")),
            "title": str(row.get("title", ""))[:100],
        })
    return out


def _audit_kb_categories() -> dict:
    entries = _load_kb_entries()
    access = _load_json(KNOWLEDGE_ACCESS_REL) or {}
    by_category: dict[str, int] = Counter()
    retrieval_by_category: dict[str, int] = Counter()
    for e in entries:
        by_category[e["category"]] += 1
        retrieval_by_category[e["category"]] += int(access.get(e["id"], 0) or 0)
    candidates = []
    for cat, n in by_category.items():
        retrievals = retrieval_by_category[cat]
        if n >= 15 and retrievals == 0:
            candidates.append({
                "category": cat,
                "entries": n,
                "retrievals": retrievals,
                "verdict": "UNUSED",
                "recommendation": f"{cat} has {n} entries but zero retrievals — consider merging with an adjacent category",
            })
        elif n >= 10 and retrievals > 0 and retrievals < n / 10:
            candidates.append({
                "category": cat,
                "entries": n,
                "retrievals": retrievals,
                "verdict": "UNDER_QUERIED",
                "recommendation": f"{cat} has {n} entries but only {retrievals} retrievals — content may be too abstract or poorly titled",
            })
    return {
        "by_category": dict(by_category),
        "retrieval_by_category": dict(retrieval_by_category),
        "candidates": candidates,
    }


def _audit_silent_injections(events: list[dict]) -> dict:
    """For every jurisdiction_inject event, check if the same session had a
    subsequent mcp__HME__read before the next round_complete. An inject
    that isn't followed by a read in the same session is 'silent' — the
    Evolver saw the context but didn't act on it by deepening its read."""
    by_session: dict[str, list[dict]] = {}
    for e in events:
        s = e.get("session") or "?"
        by_session.setdefault(s, []).append(e)
    silent = 0
    followed = 0
    for session, evs in by_session.items():
        open_injects: list[dict] = []
        for e in evs:
            if e.get("event") == "jurisdiction_inject":
                open_injects.append(e)
            elif e.get("event") == "file_written" and e.get("hme_read_prior") is True:
                # Any prior injects count as "followed" for this session
                followed += len(open_injects)
                open_injects = []
            elif e.get("event") == "round_complete":
                silent += len(open_injects)
                open_injects = []
        # Trailing open injects at end of history are not yet resolved
    total = silent + followed
    rate = (followed / total) if total > 0 else None
    candidates = []
    if total >= 5 and rate is not None and rate < 0.3:
        candidates.append({
            "verdict": "INJECTIONS_IGNORED",
            "followed": followed,
            "silent": silent,
            "follow_rate": round(rate, 3),
            "recommendation": (
                "proxy jurisdiction injections are being ignored — the Evolver "
                "sees the context but doesn't deepen with read(mode='before'). "
                "Consider making the injection more explicit or adding a "
                "block-until-read gate for high-stakes zones."
            ),
        })
    return {
        "injections_total": total,
        "followed": followed,
        "silent": silent,
        "follow_rate": rate,
        "candidates": candidates,
    }


def _audit_prediction_overconfidence() -> dict:
    data = _load_json(ACCURACY_REL) or {}
    ema = data.get("ema")
    rounds = data.get("rounds") or []
    candidates = []
    if isinstance(ema, (int, float)) and len(rounds) >= 5 and ema < 0.5:
        candidates.append({
            "verdict": "CASCADE_UNRELIABLE",
            "ema": round(ema, 3),
            "rounds_observed": len(rounds),
            "recommendation": (
                "cascade prediction EMA below 0.5 over the last several rounds. "
                "HME's dependency-graph model is not actually predicting where "
                "edits propagate. Investigate whether the provides/consumes "
                "registries have drifted."
            ),
        })
    return {"ema": ema, "rounds_observed": len(rounds), "candidates": candidates}


def _audit_musical_anchor() -> dict:
    """The strongest CASCADE_UNRELIABLE signal: HME's self-coherence score
    doesn't correlate with the music it produces. Every internal HME metric
    is ultimately circular (they all depend on each other). Only the
    musical correlation provides external ground-truth about whether HME's
    process discipline is actually producing better music. A flat or
    negative correlation means HME is optimizing the wrong thing.

    This differs from _audit_prediction_overconfidence: that one checks
    whether the cascade graph's structural predictions hold; this one
    checks whether the entire self-model tracks reality at all.
    """
    data = _load_json(CORRELATION_REL) or {}
    corrs = data.get("correlations", {})
    history = data.get("history") or []
    candidates: list[dict] = []

    # Primary anchor: coherence ↔ verdict correlation. Missing or degenerate
    # (null r from zero-variance inputs) is the top-priority red flag.
    primary_key = "hme_coherence__verdict_numeric"
    primary = corrs.get(primary_key) or {}
    primary_r = primary.get("r")
    primary_n = primary.get("n", 0)
    degenerate = primary.get("degenerate", False)

    if len(history) >= 5:
        if degenerate or primary_r is None:
            candidates.append({
                "verdict": "ANCHOR_DEGENERATE",
                "correlation": primary_key,
                "rounds": primary_n or len(history),
                "reason": primary.get("reason", "null r"),
                "recommendation": (
                    "hme_coherence ↔ musical-verdict correlation is degenerate "
                    "(typically because coherence is stuck at one value). "
                    "HME's external anchor is unusable: self-score can't be "
                    "validated against real musical outcomes. Diagnose the "
                    "upstream metric that's stuck before trusting any "
                    "HME-reported improvement."
                ),
            })
        elif isinstance(primary_r, (int, float)) and abs(primary_r) < 0.15 and primary_n >= 10:
            candidates.append({
                "verdict": "ANCHOR_WEAK",
                "correlation": primary_key,
                "r": round(primary_r, 3),
                "rounds": primary_n,
                "recommendation": (
                    f"hme_coherence ↔ verdict correlation |r|={abs(primary_r):.2f} "
                    f"over {primary_n} rounds. HME's self-score is weakly "
                    f"tracking musical outcome. Either the coherence formula "
                    f"doesn't capture what drives verdict, or verdict itself "
                    f"isn't sensitive enough. Consider weighting coherence "
                    f"against perceptual_complexity / clap_tension instead."
                ),
            })
    return {
        "correlations": corrs,
        "rounds": len(history),
        "candidates": candidates,
    }


def self_audit_report() -> str:
    _track("self_audit")
    events = _load_events()
    kb_audit = _audit_kb_categories()
    inject_audit = _audit_silent_injections(events)
    pred_audit = _audit_prediction_overconfidence()
    music_audit = _audit_musical_anchor()

    all_candidates = (
        kb_audit["candidates"] + inject_audit["candidates"] +
        pred_audit["candidates"] + music_audit["candidates"]
    )

    lines = [
        "# HME Self-Audit",
        "",
        f"**Evolution candidates:** {len(all_candidates)}",
        "",
    ]

    # KB category section
    lines.append("## KB category usage")
    for cat, n in sorted(kb_audit["by_category"].items(), key=lambda x: -x[1]):
        r = kb_audit["retrieval_by_category"].get(cat, 0)
        rate = f"{r}/{n}"
        lines.append(f"  {cat:<20} {n:>4} entries  {rate:>10} retrievals")
    if kb_audit["candidates"]:
        lines.append("")
        for c in kb_audit["candidates"]:
            lines.append(f"  ⚠ {c['verdict']}: {c['recommendation']}")

    # Injection section
    lines.append("")
    lines.append("## Proxy injection follow-through")
    total = inject_audit["injections_total"]
    if total == 0:
        lines.append("  No jurisdiction_inject events recorded yet (proxy may not be running).")
    else:
        rate = inject_audit["follow_rate"]
        rate_s = f"{rate * 100:.0f}%" if isinstance(rate, (int, float)) else "n/a"
        lines.append(
            f"  {inject_audit['followed']}/{total} follow-through ({rate_s})  "
            f"silent={inject_audit['silent']}"
        )
        for c in inject_audit["candidates"]:
            lines.append(f"  ⚠ {c['verdict']}: {c['recommendation']}")

    # Cascade confidence section
    lines.append("")
    lines.append("## Cascade prediction reliability")
    ema = pred_audit["ema"]
    if ema is None:
        lines.append("  No cascade predictions scored yet.")
    else:
        lines.append(
            f"  EMA: {ema * 100:.1f}%  over {pred_audit['rounds_observed']} rounds"
        )
        for c in pred_audit["candidates"]:
            lines.append(f"  ⚠ {c['verdict']}: {c['recommendation']}")

    # Musical anchor section — the external-anchor check: does HME's
    # self-score correlate with the music it produces?
    lines.append("")
    lines.append("## Musical anchor correlation")
    if music_audit["rounds"] < 5:
        lines.append(
            f"  Only {music_audit['rounds']} round(s) of history — need ≥5 "
            f"for meaningful anchor check."
        )
    else:
        primary = music_audit["correlations"].get("hme_coherence__verdict_numeric") or {}
        r = primary.get("r")
        n = primary.get("n", music_audit["rounds"])
        if primary.get("degenerate"):
            lines.append(f"  r=n/a  n={n}  DEGENERATE ({primary.get('reason','?')})")
        elif r is None:
            lines.append(f"  r=n/a  n={n}  (no data)")
        else:
            lines.append(f"  r={r:+.3f}  n={n}  (hme_coherence ↔ musical verdict)")
        for c in music_audit["candidates"]:
            lines.append(f"  ⚠ {c['verdict']}: {c['recommendation']}")

    if all_candidates:
        lines.append("")
        lines.append("## Self-Evolution Candidates")
        for i, c in enumerate(all_candidates, 1):
            lines.append(f"  {i}. [{c.get('verdict', '?')}] {c.get('recommendation', '')}")
    else:
        lines.append("")
        lines.append("## Self-Evolution Candidates")
        lines.append("  None — HME architecture passes all self-audit thresholds.")
    return "\n".join(lines)
