#!/usr/bin/env python3
"""Antagonism bridge: streak-sensitivity <-> error-log signal-quality,
coupled to post-banner resolution velocity.

The tension: low streak threshold surfaces errors fast (more attention) at
the cost of false positives (more noise). High threshold is clean signal
at the cost of slow surfacing. These two forces are negatively correlated
across any fixed threshold value.

The shared upstream the antagonism bridge principle says we need to find:
*did the last banner result in a real fix, or in the agent ignoring it?*
Measurable from the LIFESAVER state files:
  tmp/hme-errors.turnstart  — line count at the start of a turn
  tmp/hme-errors.lastread   — watermark advanced by stop.sh only after a fix

Resolution-velocity proxy: for each turn where errors were surfaced, did
the watermark advance to match the turn-end line count? That means fixed.
Did the watermark stay stuck below a new count? That means ignored or
unresolved.

Bridge behavior (both modules driven by resolution_velocity):
  - When resolution_velocity is HIGH (banners resolve fast):
      streak_threshold LOWERS (surface earlier; agent is handling it well)
      signal_trust RAISES (banners are reliable — treat as authoritative)
  - When resolution_velocity is LOW (banners sit unresolved):
      streak_threshold RAISES (be more conservative about surfacing)
      signal_trust LOWERS (treat banners as suggestions; may need consolidation)

Opposing responses. Same signal. Classic antagonism bridge.

This script:
  - Reads tmp/hme-errors.* state to compute resolution_velocity
  - Emits a recommended HME_STREAK_WARN value based on recent history
  - Writes metrics/hme-streak-calibration.json for audit
  - Does NOT auto-apply changes; sessionstart.sh can optionally source the
    recommendation. OBSERVE-ONLY first run — the user confirms whether the
    recommendations track reality before we wire in auto-application.

Usage:
  python3 tools/HME/activity/streak_calibrator.py [--window 20] [--apply]
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path
from datetime import datetime, UTC

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", Path(__file__).resolve().parent.parent.parent.parent))
ERROR_LOG = PROJECT_ROOT / "log" / "hme-errors.log"
WATERMARK = PROJECT_ROOT / "tmp" / "hme-errors.lastread"
TURNSTART = PROJECT_ROOT / "tmp" / "hme-errors.turnstart"
HISTORY = PROJECT_ROOT / "metrics" / "hme-streak-calibration-history.jsonl"
OUTPUT = PROJECT_ROOT / "metrics" / "hme-streak-calibration.json"

# Bounds on recommended threshold. Bridges are constrained — an uncontrolled
# controller violates hypermeta jurisdiction. These locked ranges prevent the
# bridge from recommending values outside safe operating envelope.
MIN_THRESHOLD = 2
MAX_THRESHOLD = 10
DEFAULT_THRESHOLD = 5  # matches .env HME_STREAK_WARN fallback


def _read_int(p: Path, default: int = 0) -> int:
    try:
        return int(p.read_text().strip())
    except Exception:
        return default


def _count_lines(p: Path) -> int:
    if not p.is_file():
        return 0
    try:
        with open(p, "rb") as f:
            return sum(1 for _ in f)
    except Exception:
        return 0


def _load_history(window: int) -> list[dict]:
    if not HISTORY.is_file():
        return []
    out = []
    try:
        with open(HISTORY) as f:
            lines = f.readlines()
        for line in lines[-window:]:
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    except Exception:
        pass
    return out


def compute_resolution_velocity(history: list[dict]) -> float:
    """Resolution velocity = (# turns where watermark advanced to fully cover
    turn-end errors) / (# turns with errors). Range 0.0 (nothing resolved)
    to 1.0 (everything resolved). Returns 0.5 for insufficient data.
    """
    if not history:
        return 0.5
    turns_with_errors = 0
    turns_resolved = 0
    for h in history:
        if h.get("turn_end_lines", 0) > h.get("turnstart_lines", 0):
            turns_with_errors += 1
            # Resolved iff watermark caught up to turn_end_lines.
            if h.get("watermark_at_turn_end", 0) >= h.get("turn_end_lines", 0):
                turns_resolved += 1
    if turns_with_errors == 0:
        return 0.5  # no data -> neutral
    return turns_resolved / turns_with_errors


def recommend_threshold(velocity: float) -> int:
    """Antagonism bridge output: streak threshold as inverse function of
    resolution velocity. High velocity -> lower threshold (surface earlier,
    agent handles it). Low velocity -> higher threshold (reduce noise).

    Linear interpolation in the bounded envelope [MIN_THRESHOLD, MAX_THRESHOLD].
    velocity=0.0 -> MAX_THRESHOLD (max conservatism, banners are being ignored)
    velocity=1.0 -> MIN_THRESHOLD (full confidence, surface aggressively)
    velocity=0.5 -> DEFAULT_THRESHOLD (neutral)
    """
    # Two-segment linear so velocity=0.5 hits exactly DEFAULT_THRESHOLD
    if velocity >= 0.5:
        # Scale from DEFAULT to MIN across [0.5, 1.0]
        t = (velocity - 0.5) / 0.5
        return max(MIN_THRESHOLD, round(DEFAULT_THRESHOLD - t * (DEFAULT_THRESHOLD - MIN_THRESHOLD)))
    else:
        # Scale from MAX to DEFAULT across [0.0, 0.5]
        t = velocity / 0.5
        return min(MAX_THRESHOLD, round(MAX_THRESHOLD - t * (MAX_THRESHOLD - DEFAULT_THRESHOLD)))


def signal_trust_from(velocity: float) -> float:
    """The paired response: signal trust in [0.3, 1.0] scaling with velocity."""
    return round(0.3 + 0.7 * velocity, 3)


def main() -> None:
    ap = argparse.ArgumentParser(description="LIFESAVER streak calibrator (antagonism bridge)")
    ap.add_argument("--window", type=int, default=20, help="Recent turns to average over (default 20)")
    ap.add_argument("--record", action="store_true",
                    help="Append current state to history (sessionstart.sh should call this)")
    args = ap.parse_args()

    turnstart_lines = _read_int(TURNSTART)
    watermark_lines = _read_int(WATERMARK)
    total_lines = _count_lines(ERROR_LOG)

    if args.record:
        HISTORY.parent.mkdir(parents=True, exist_ok=True)
        with open(HISTORY, "a") as f:
            f.write(json.dumps({
                "ts": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "turnstart_lines": turnstart_lines,
                "watermark_at_turn_end": watermark_lines,
                "turn_end_lines": total_lines,
            }) + "\n")

    history = _load_history(args.window)
    velocity = compute_resolution_velocity(history)
    recommended = recommend_threshold(velocity)
    trust = signal_trust_from(velocity)

    result = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "window_turns": args.window,
        "history_samples": len(history),
        "resolution_velocity": round(velocity, 3),
        "recommended_streak_warn": recommended,
        "signal_trust": trust,
        "envelope": {"min": MIN_THRESHOLD, "max": MAX_THRESHOLD, "default": DEFAULT_THRESHOLD},
        "bridge": {
            "principle": "antagonism_bridge",
            "shared_upstream": "resolution_velocity",
            "opposing_responses": {
                "streak_threshold": "lower when velocity high, raise when velocity low",
                "signal_trust": "raise when velocity high, lower when velocity low"
            },
        },
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(result, f, indent=2)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
