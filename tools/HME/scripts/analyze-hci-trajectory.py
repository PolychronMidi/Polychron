#!/usr/bin/env python3
"""HCI Trajectory Analyzer — time-series analysis over holograph snapshots.

Reads all holograph snapshots in metrics/holograph/, extracts HCI scores and
per-verifier scores, computes trend/volatility/delta, and writes a trajectory
record to metrics/hme-trajectory.json.

This is the time axis of the self-coherence substrate. Each holograph is a
moment; the trajectory is the orbit. Patterns in the orbit predict future
drift: if HCI has been sliding for 3+ snapshots in a row, the next one is
likely to drop further unless a fix lands.

Prediction is a simple linear regression over the last N holographs (default
5). With fewer than 3 data points, prediction is skipped. With 3+, the
predicted next HCI is extrapolated from the slope, clamped to [0, 100].

Output schema:
    {
      "generated_at": epoch_seconds,
      "holograph_count": int,
      "window_size": int (how many snapshots fed into the trend),
      "current": {
        "hci": float,
        "captured_at": epoch_seconds,
        "path": str
      },
      "history": [
        {"hci": float, "captured_at": epoch, "path": str}, ...
      ],
      "trend": {
        "slope_per_snapshot": float,        # HCI points per snapshot
        "slope_per_day": float,             # HCI points per day (normalized)
        "volatility": float,                # stddev of HCI across window
        "direction": "up"|"down"|"flat"
      },
      "prediction": {
        "next_hci_predicted": float,        # clamped 0-100
        "confidence": float (0-1),          # 1 - (volatility / 10)
        "warning": str or null              # non-null if drift predicted
      },
      "per_category_trend": {
        "code": {"current": float, "slope": float},
        ...
      }
    }

Runs as a pipeline step and from verify-coherence (optional). Wired into
sessionstart.sh to surface recent drift in the orientation banner.

Usage:
    python3 tools/HME/scripts/analyze-hci-trajectory.py           # write file
    python3 tools/HME/scripts/analyze-hci-trajectory.py --stdout  # print JSON
    python3 tools/HME/scripts/analyze-hci-trajectory.py --summary # human text
"""
import glob
import json
import os
import sys
import time

try:
    import numpy as np  # used for linear regression
    _HAS_NUMPY = True
except ImportError:
    _HAS_NUMPY = False

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_HOLOGRAPH_DIR = os.path.join(_PROJECT, "metrics", "holograph")
_OUTPUT = os.path.join(_PROJECT, "metrics", "hme-trajectory.json")
_DEFAULT_WINDOW = 5


def _load_holographs() -> list:
    """Load all holograph JSON files sorted by capture time."""
    paths = sorted(glob.glob(os.path.join(_HOLOGRAPH_DIR, "holograph-*.json")))
    snapshots = []
    for path in paths:
        try:
            with open(path) as f:
                data = json.load(f)
        except Exception:
            continue
        captured = data.get("captured_at", 0)
        hci = data.get("hci", {}).get("hci")
        if hci is None:
            continue
        snapshots.append({
            "path": os.path.relpath(path, _PROJECT),
            "captured_at": captured,
            "hci": float(hci),
            "categories": data.get("hci", {}).get("categories", {}),
            "verifiers": data.get("hci", {}).get("verifiers", {}),
        })
    snapshots.sort(key=lambda s: s["captured_at"])
    return snapshots


def _simple_linear_regression(xs: list, ys: list) -> tuple:
    """Return (slope, intercept). Pure Python fallback if numpy not available."""
    if _HAS_NUMPY:
        a = np.array(xs, dtype=float)
        b = np.array(ys, dtype=float)
        if len(a) < 2:
            return 0.0, (b[0] if len(b) else 0.0)
        slope, intercept = np.polyfit(a, b, 1)
        return float(slope), float(intercept)
    # Pure Python least-squares
    n = len(xs)
    if n < 2:
        return 0.0, (ys[0] if ys else 0.0)
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    den = sum((xs[i] - mx) ** 2 for i in range(n))
    slope = num / den if den > 0 else 0.0
    intercept = my - slope * mx
    return slope, intercept


def _stddev(vs: list) -> float:
    if len(vs) < 2:
        return 0.0
    m = sum(vs) / len(vs)
    return (sum((v - m) ** 2 for v in vs) / len(vs)) ** 0.5


def compute_trajectory(window_size: int = _DEFAULT_WINDOW) -> dict:
    snapshots = _load_holographs()
    count = len(snapshots)
    now = time.time()

    if count == 0:
        return {
            "generated_at": now,
            "holograph_count": 0,
            "window_size": 0,
            "_warning": "no holographs available — run snapshot-holograph.py to seed",
        }

    window = snapshots[-window_size:] if count > window_size else snapshots
    current = snapshots[-1]

    xs = [s["captured_at"] for s in window]
    ys = [s["hci"] for s in window]
    slope, _intercept = _simple_linear_regression(xs, ys)
    volatility = _stddev(ys)

    # slope is HCI points per second (since x is in seconds)
    slope_per_snapshot = slope * ((xs[-1] - xs[0]) / max(1, len(window) - 1)) if len(window) >= 2 else 0.0
    slope_per_day = slope * 86400

    direction = "flat"
    if abs(slope_per_day) > 0.5:
        direction = "up" if slope_per_day > 0 else "down"

    # Prediction: extrapolate one more snapshot ahead
    prediction = None
    if len(window) >= 3:
        avg_interval = (xs[-1] - xs[0]) / (len(window) - 1)
        next_x = xs[-1] + avg_interval
        predicted = slope * next_x + _intercept
        predicted = max(0.0, min(100.0, predicted))
        confidence = max(0.0, min(1.0, 1.0 - volatility / 10.0))
        warning = None
        if predicted < 80:
            warning = f"predicted HCI {predicted:.1f} below threshold 80"
        elif direction == "down" and current["hci"] > 90 and predicted < current["hci"] - 5:
            warning = f"sustained downward trend — drift projected from {current['hci']:.1f} to {predicted:.1f}"
        prediction = {
            "next_hci_predicted": round(predicted, 1),
            "confidence": round(confidence, 3),
            "warning": warning,
        }

    # Per-category trends
    per_cat: dict = {}
    if current["categories"]:
        for cat_name, cat_info in current["categories"].items():
            cur_score = cat_info.get("score", 0.0) * 100
            # Compute slope if we have history for this category
            cat_ys = []
            cat_xs = []
            for s in window:
                cats = s.get("categories", {})
                if cat_name in cats:
                    cat_xs.append(s["captured_at"])
                    cat_ys.append(cats[cat_name].get("score", 0.0) * 100)
            cat_slope = 0.0
            if len(cat_ys) >= 2:
                cs, _ci = _simple_linear_regression(cat_xs, cat_ys)
                cat_slope = cs * 86400  # per day
            per_cat[cat_name] = {
                "current": round(cur_score, 1),
                "slope_per_day": round(cat_slope, 3),
            }

    return {
        "generated_at": now,
        "holograph_count": count,
        "window_size": len(window),
        "current": {
            "hci": current["hci"],
            "captured_at": current["captured_at"],
            "path": current["path"],
        },
        "history": [
            {"hci": s["hci"], "captured_at": s["captured_at"], "path": s["path"]}
            for s in window
        ],
        "trend": {
            "slope_per_snapshot": round(slope_per_snapshot, 3),
            "slope_per_day": round(slope_per_day, 3),
            "volatility": round(volatility, 3),
            "direction": direction,
        },
        "prediction": prediction,
        "per_category_trend": per_cat,
    }


def format_summary(traj: dict) -> str:
    if traj.get("holograph_count", 0) == 0:
        return "[HCI trajectory] no snapshots yet — run snapshot-holograph.py"
    cur = traj["current"]["hci"]
    count = traj["holograph_count"]
    trend = traj["trend"]
    pred = traj.get("prediction") or {}
    parts = [
        f"[HCI trajectory] current={cur:.1f} ({count} snapshots)",
        f"trend={trend['direction']} ({trend['slope_per_day']:+.2f}/day, vol={trend['volatility']:.2f})",
    ]
    if pred:
        parts.append(f"predicted={pred['next_hci_predicted']:.1f} conf={pred['confidence']:.2f}")
        if pred.get("warning"):
            parts.append(f"WARNING: {pred['warning']}")
    return " | ".join(parts)


def main(argv: list) -> int:
    try:
        traj = compute_trajectory()
    except Exception as e:
        import traceback
        sys.stderr.write(f"trajectory error: {e}\n{traceback.format_exc()}")
        return 2

    if "--summary" in argv:
        print(format_summary(traj))
        return 0
    if "--stdout" in argv:
        print(json.dumps(traj, indent=2))
        return 0

    os.makedirs(os.path.dirname(_OUTPUT), exist_ok=True)
    with open(_OUTPUT, "w") as f:
        json.dump(traj, f, indent=2)
    print(f"Trajectory written: {_OUTPUT}")
    print(format_summary(traj))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
