"""Drift envelope math — extracted from compute-legendary-drift.py in R31.

Pure computation: flatten snapshot into numeric leaf fields, build the
exponentially-weighted envelope, compute per-field z-scores + overall drift.
No I/O, no side effects — separation for testability and main-file clarity.

Decay history:
  0.9 — too slow (R25 density drift grew unchecked under 0.9 adaptation)
  0.7 — too fast (R28 density sign-flipped: envelope oscillation)
  0.85 — stable middle (R29+): newest=1.0, 3-old=0.61, 5-old=0.44. Regime
         shifts absorbed in ~4 rounds; single-round noise doesn't flip the
         envelope center.
"""
from __future__ import annotations
import math

DECAY = 0.85
STDEV_FLOOR = 1e-4  # below this, a field's distribution is effectively a point


def flatten(state: dict) -> dict[str, float]:
    """Extract all numeric leaf fields from a snapshot dict."""
    flat: dict[str, float] = {}
    for k, v in state.items():
        if isinstance(v, (int, float)):
            flat[k] = float(v)
        elif isinstance(v, dict):
            for sk, sv in v.items():
                if isinstance(sv, (int, float)):
                    flat[f"{k}.{sk}"] = float(sv)
    return flat


def compute_envelope(snaps: list[dict]) -> dict[str, dict]:
    """Per-field weighted median + weighted stdev.

    weight = DECAY^age where age=0 is the most-recent snapshot. Weighted
    median via cumulative-weight lookup; weighted stdev via
    Σ(w·(x-μ)²) / Σw where μ is the weighted mean.
    """
    if not snaps:
        return {}
    n = len(snaps)
    by_field: dict[str, list[tuple[float, float]]] = {}
    for i, s in enumerate(snaps):
        age = (n - 1) - i
        w = DECAY ** age
        for k, v in flatten(s).items():
            by_field.setdefault(k, []).append((v, w))
    env: dict[str, dict] = {}
    for k, pairs in by_field.items():
        if len(pairs) < 2:
            continue
        total_w = sum(w for _, w in pairs)
        if total_w <= 0:
            continue
        w_mean = sum(v * w for v, w in pairs) / total_w
        sorted_pairs = sorted(pairs, key=lambda p: p[0])
        cum = 0.0
        half = total_w / 2.0
        w_median = sorted_pairs[-1][0]
        for v, w in sorted_pairs:
            cum += w
            if cum >= half:
                w_median = v
                break
        w_var = sum(w * (v - w_mean) ** 2 for v, w in pairs) / total_w
        sd = math.sqrt(w_var)
        env[k] = {"median": w_median, "stdev": sd, "n": len(pairs),
                  "effective_n": round(total_w, 2)}
    return env


def compute_drift(current_flat: dict[str, float], envelope: dict[str, dict]
                  ) -> tuple[float, list[dict]]:
    """Mean |z-score| across fields with meaningful variance, plus outliers.

    Fields with sub-floor stdev are skipped — dividing by near-zero produces
    NaN-grade z-scores. STDEV_FLOOR=1e-4 caught this in R27 when tight HCI
    clustering collapsed weighted stdev to ~1e-14.
    """
    z_scores = []
    outliers = []
    for k, v in current_flat.items():
        e = envelope.get(k)
        if not e or e["stdev"] < STDEV_FLOOR:
            continue
        z = (v - e["median"]) / e["stdev"]
        z_scores.append(abs(z))
        if abs(z) >= 2.0:
            outliers.append({
                "field": k,
                "current": round(v, 4),
                "median": round(e["median"], 4),
                "stdev": round(e["stdev"], 4),
                "z_score": round(z, 2),
            })
    outliers.sort(key=lambda o: -abs(o["z_score"]))
    drift = sum(z_scores) / len(z_scores) if z_scores else 0.0
    return (drift, outliers)
