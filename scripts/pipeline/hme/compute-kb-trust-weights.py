#!/usr/bin/env python3
"""Phase 4.2 — KB trust weight computation.

Every KB entry gains an epistemic trust weight derived from the round it
was written in. Formula:

    trust = 0.4 * coherence_at_write
          + 0.3 * accuracy_at_write
          + 0.2 * verdict_bonus
          + 0.1 * age_decay

Each component is 0..1, bounded; total is clamped. Components default to
0.5 (uniform prior) when unavailable — so entries predating the metric
are not unfairly penalized.

    coherence_at_write   = round coherence score for the closest-in-time
                           round_complete event preceding the entry
    accuracy_at_write    = prediction accuracy EMA closest to the entry
    verdict_bonus        = 1.0 STABLE/EVOLVED, 0.3 DRIFTED, 0.5 other
    age_decay            = 1.0 for <30d, linearly decays to 0.5 at 180d

Output: metrics/kb-trust-weights.json keyed by entry id with trust,
components, tier (HIGH >= 0.75, MED >= 0.5, LOW < 0.5).

The proxy reads this file and labels injected KB entries by tier. The
crystallizer already pools rounds; a future extension will use trust
to weight pattern promotion.
"""
from __future__ import annotations

import json
import os
import sys
import time

PROJECT_ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get(
    "PROJECT_ROOT", "/home/jah/Polychron"
)
METRICS_DIR = os.path.join(PROJECT_ROOT, "output", "metrics")
KB_PATH = os.path.join(PROJECT_ROOT, "tools", "HME", "KB")
OUT_PATH = os.path.join(METRICS_DIR, "kb-trust-weights.json")
COHERENCE_PATH = os.path.join(METRICS_DIR, "hme-coherence.json")
ACCURACY_PATH = os.path.join(METRICS_DIR, "hme-prediction-accuracy.json")
MUSICAL_PATH = os.path.join(METRICS_DIR, "hme-musical-correlation.json")


def _load_json(path: str):
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


MAX_MATCH_DELTA_S = 14 * 86400  # 14 days — beyond this, prefer the uniform prior


def _closest_history_entry(
    history: list[dict], target_ts: float, ts_field: str = "timestamp"
) -> dict | None:
    """Return the history record closest to target_ts (seconds since epoch),
    but only if it's within MAX_MATCH_DELTA_S of the target. Otherwise return
    None so the caller falls back to the uniform prior — we don't want a
    single distant record dominating every entry's weight."""
    if not history:
        return None
    best = None
    best_d = float("inf")
    for rec in history:
        rec_ts = rec.get(ts_field)
        if isinstance(rec_ts, str):
            try:
                import datetime as _dt
                rec_ts = _dt.datetime.fromisoformat(rec_ts.replace("Z", "+00:00")).timestamp()
            except ValueError:
                continue
        elif not isinstance(rec_ts, (int, float)):
            continue
        d = abs(rec_ts - target_ts)
        if d < best_d:
            best_d = d
            best = rec
    if best is None:
        return None
    if best_d > MAX_MATCH_DELTA_S:
        return None
    return best


def _verdict_bonus(verdict: str | None) -> float:
    if not verdict:
        return 0.5
    v = verdict.upper()
    if v in ("STABLE", "EVOLVED"):
        return 1.0
    if v == "DRIFTED":
        return 0.3
    return 0.5


def _age_decay(entry_ts: float, now: float) -> float:
    age_days = max(0.0, (now - entry_ts) / 86400.0)
    if age_days <= 30:
        return 1.0
    if age_days >= 180:
        return 0.5
    # Linear 30→180 days, 1.0→0.5
    frac = (age_days - 30) / (180 - 30)
    return 1.0 - frac * 0.5


def compute_trust(
    entry_ts: float,
    coherence_hist: list[dict],
    accuracy_hist: list[dict],
    musical_hist: list[dict],
    now: float,
) -> dict:
    # History-based components require at least MIN_HISTORY points to be
    # statistically meaningful — otherwise a single degenerate data point
    # (e.g. a degraded session) drags every entry to the floor.
    MIN_HISTORY = 3

    # Coherence at write time — pull from musical-correlation history which
    # records hme_coherence per round with a timestamp.
    coh = 0.5
    if len(musical_hist) >= MIN_HISTORY:
        rec = _closest_history_entry(musical_hist, entry_ts)
        if rec and isinstance(rec.get("hme_coherence"), (int, float)):
            coh = float(rec["hme_coherence"])

    # Accuracy at write time — from accuracy history
    acc = 0.5
    if len(accuracy_hist) >= MIN_HISTORY:
        rec = _closest_history_entry(accuracy_hist, entry_ts)
        if rec and isinstance(rec.get("ema_after"), (int, float)):
            acc = float(rec["ema_after"])

    # Verdict bonus — also from musical history snapshot
    verdict = None
    if len(musical_hist) >= MIN_HISTORY:
        rec = _closest_history_entry(musical_hist, entry_ts)
        if rec:
            verdict = rec.get("fingerprint_verdict")
    vb = _verdict_bonus(verdict)

    ad = _age_decay(entry_ts, now)

    trust = 0.4 * coh + 0.3 * acc + 0.2 * vb + 0.1 * ad
    trust = max(0.0, min(1.0, trust))

    if trust >= 0.75:
        tier = "HIGH"
    elif trust >= 0.5:
        tier = "MED"
    else:
        tier = "LOW"

    return {
        "trust": round(trust, 4),
        "tier": tier,
        "components": {
            "coherence_at_write": round(coh, 4),
            "accuracy_at_write": round(acc, 4),
            "verdict_bonus": round(vb, 4),
            "age_decay": round(ad, 4),
            "verdict": verdict,
        },
    }


def main() -> int:
    try:
        import lancedb  # noqa: WPS433
    except ImportError:
        print("compute-kb-trust-weights: lancedb unavailable", file=sys.stderr)
        return 0
    try:
        db = lancedb.connect(KB_PATH)
        tbl = db.open_table("knowledge")
        df = tbl.to_pandas()
    except Exception as _e:  # noqa: BLE001
        print(f"compute-kb-trust-weights: KB read failed: {type(_e).__name__}: {_e}", file=sys.stderr)
        return 0

    coherence_data = _load_json(COHERENCE_PATH) or {}
    accuracy_data = _load_json(ACCURACY_PATH) or {}
    musical_data = _load_json(MUSICAL_PATH) or {}

    coherence_hist: list[dict] = []  # hme-coherence.json is single-record; no history field
    accuracy_hist = accuracy_data.get("rounds", []) if isinstance(accuracy_data, dict) else []
    musical_hist = musical_data.get("history", []) if isinstance(musical_data, dict) else []

    now = time.time()
    entries: dict = {}
    tier_counts = {"HIGH": 0, "MED": 0, "LOW": 0}

    for _, row in df.iterrows():
        entry_id = str(row.get("id", ""))
        if not entry_id:
            continue
        entry_ts = float(row.get("timestamp", 0) or 0)
        if entry_ts <= 0:
            entry_ts = now  # fall back to now for entries without timestamps

        # Phase 5.5 — human ground-truth entries always inherit HIGH tier
        # regardless of the normal trust formula.
        tags_str = str(row.get("tags", "") or "")
        is_ground_truth = "human_ground_truth" in tags_str
        if is_ground_truth:
            score = {
                "trust": 1.0,
                "tier": "HIGH",
                "components": {
                    "coherence_at_write": None,
                    "accuracy_at_write": None,
                    "verdict_bonus": None,
                    "age_decay": None,
                    "verdict": None,
                    "override": "human_ground_truth",
                },
            }
        else:
            score = compute_trust(entry_ts, coherence_hist, accuracy_hist, musical_hist, now)
        entries[entry_id] = {
            "id": entry_id,
            "title": str(row.get("title", ""))[:120],
            "category": str(row.get("category", "")),
            "timestamp": entry_ts,
            "ground_truth": is_ground_truth,
            **score,
        }
        tier_counts[score["tier"]] += 1

    report = {
        "meta": {
            "script": "compute-kb-trust-weights.py",
            "timestamp": int(now),
            "entries_total": len(entries),
            "tier_counts": tier_counts,
            "formula": "0.4*coh + 0.3*acc + 0.2*verdict_bonus + 0.1*age_decay",
        },
        "entries": entries,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")

    print(
        f"compute-kb-trust-weights: {len(entries)} entries  "
        f"HIGH={tier_counts['HIGH']}  MED={tier_counts['MED']}  LOW={tier_counts['LOW']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
