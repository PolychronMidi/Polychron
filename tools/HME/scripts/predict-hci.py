#!/usr/bin/env python3
"""H9: Predictive HCI — forecasts next HCI score from recent holograph history.

Reads metrics/holograph/*.json, extracts the HCI time series, and fits a
simple linear regression on the last N snapshots (default 5). Predicts
the HCI score AT THE NEXT SNAPSHOT given current drift velocity. Writes
metrics/hme-hci-forecast.json which the PredictiveHCIVerifier consumes.

This is the "detect drift before it manifests" layer. If trend is flat
and predicted == current, no alert. If trend is downward and predicted
crosses the 80-point threshold, fire a WARN so the agent notices BEFORE
the actual HCI reaches that floor.

Output schema:
    {
      "generated_at": epoch,
      "history_length": int,
      "current_hci": float,
      "predicted_next_hci": float,
      "confidence": float (0-1, based on volatility),
      "trend": "rising" | "falling" | "flat",
      "slope_per_snapshot": float,
      "warning": str or null,
      "samples": [{"ts": float, "hci": float}, ...]
    }

Usage:
    python3 tools/HME/scripts/predict-hci.py
    python3 tools/HME/scripts/predict-hci.py --summary
"""
import glob
import json
import os
import sys
import time

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
METRICS_DIR = os.environ.get("METRICS_DIR") or os.path.join(_PROJECT, "output", "metrics")
_OUTPUT = os.path.join(METRICS_DIR, "hme-hci-forecast.json")


def _simple_regression(xs: list, ys: list) -> tuple:
    """Least-squares linear fit. Returns (slope, intercept)."""
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


def predict() -> dict:
    snap_dir = os.path.join(METRICS_DIR, "holograph")
    if not os.path.isdir(snap_dir):
        return {"_warning": "no holograph dir", "generated_at": time.time()}
    paths = sorted(glob.glob(os.path.join(snap_dir, "holograph-*.json")))
    samples = []
    for path in paths:
        try:
            with open(path) as f:
                data = json.load(f)
            hci = data.get("hci", {}).get("hci")
            ts = data.get("captured_at", 0)
            if hci is not None and ts > 0:
                samples.append({"ts": float(ts), "hci": float(hci)})
        except Exception:
            continue
    samples.sort(key=lambda s: s["ts"])
    if len(samples) < 2:
        return {
            "generated_at": time.time(),
            "history_length": len(samples),
            "_warning": "need 2+ holographs for prediction",
            "samples": samples,
        }

    window = samples[-5:] if len(samples) >= 5 else samples
    xs = [s["ts"] for s in window]
    ys = [s["hci"] for s in window]
    slope, intercept = _simple_regression(xs, ys)
    volatility = _stddev(ys)
    current = ys[-1]

    # Extrapolate one snapshot ahead
    if len(window) >= 2:
        avg_interval = (xs[-1] - xs[0]) / max(1, len(window) - 1)
        next_x = xs[-1] + avg_interval
        predicted = slope * next_x + intercept
    else:
        predicted = current
    predicted = max(0.0, min(100.0, predicted))
    slope_per_snapshot = slope * (avg_interval if len(window) >= 2 else 0)

    direction = "flat"
    if abs(slope_per_snapshot) > 0.3:
        direction = "rising" if slope_per_snapshot > 0 else "falling"

    confidence = max(0.0, min(1.0, 1.0 - volatility / 10.0))

    warning = None
    if predicted < 80 and current >= 80:
        warning = f"predicted HCI {predicted:.1f} will cross below 80 threshold"
    elif direction == "falling" and predicted < current - 5:
        warning = f"sustained drop predicted: {current:.1f} → {predicted:.1f}"
    elif volatility > 15:
        warning = f"HCI volatile (stddev={volatility:.1f}) — prediction unreliable"

    return {
        "generated_at": time.time(),
        "history_length": len(samples),
        "window_size": len(window),
        "current_hci": round(current, 1),
        "predicted_next_hci": round(predicted, 1),
        "confidence": round(confidence, 3),
        "trend": direction,
        "slope_per_snapshot": round(slope_per_snapshot, 3),
        "volatility": round(volatility, 3),
        "warning": warning,
        "samples": samples[-10:],  # last 10 for context
    }


def main(argv: list) -> int:
    forecast = predict()
    os.makedirs(os.path.dirname(_OUTPUT), exist_ok=True)
    with open(_OUTPUT, "w") as f:
        json.dump(forecast, f, indent=2)
    if "--summary" in argv:
        if forecast.get("_warning"):
            print(f"[hci-forecast] {forecast['_warning']}")
        else:
            w = forecast.get("warning")
            w_suffix = f" | WARNING: {w}" if w else ""
            print(
                f"[hci-forecast] current={forecast['current_hci']} "
                f"predicted={forecast['predicted_next_hci']} "
                f"trend={forecast['trend']} "
                f"conf={forecast['confidence']:.2f}{w_suffix}"
            )
        return 0
    print(f"Forecast written: {_OUTPUT}")
    print(json.dumps(forecast, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
