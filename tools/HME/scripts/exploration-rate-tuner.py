#!/usr/bin/env python3
"""Exploration-rate tuner — generalizes `productive_incoherence` into a
session-level exploration/exploitation balance signal.

Inputs from output/metrics/hme-activity.jsonl:
  - file_written events:         total edits
  - productive_incoherence:      edits into KB-uncovered territory
  - coherence_violation (legacy, now disabled): was "lazy" edits

Computes `exploration_rate = productive_incoherence / total_edits` over
the current round. Writes tmp/hme-exploration-rate.txt that the
compose-time heuristics (e.g. `adaptive-config.sh`) can source.

Meta-controller side: three regimes:
  - rate < 0.1 → EXPLOIT-heavy → suggest: hit KB-uncovered modules, run
    `learn()` on previous novel territory.
  - 0.1 ≤ rate ≤ 0.4 → BALANCED → no steer.
  - rate > 0.4 → EXPLORE-heavy → suggest: consolidate, run `learn()` to
    capture findings; re-read KB for modules you've been editing.

Written as a one-liner file so _safety.sh can `source` it or a hook can
cat it cheaply. Full report at output/metrics/hme-exploration-rate.json.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parent.parent.parent.parent)
ACTIVITY = ROOT / "output" / "metrics" / "hme-activity.jsonl"
OUT_TXT = ROOT / "tmp" / "hme-exploration-rate.txt"
OUT_JSON = ROOT / "output" / "metrics" / "hme-exploration-rate.json"


def _load_current_round() -> list[dict]:
    """Events since last round_complete (or full tail)."""
    if not ACTIVITY.is_file():
        return []
    events: list[dict] = []
    for raw in ACTIVITY.read_text(encoding="utf-8", errors="replace").splitlines():
        if not raw.strip():
            continue
        try:
            events.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    last_round = -1
    for i, e in enumerate(events):
        if e.get("event") == "round_complete":
            last_round = i
    return events[last_round + 1:] if last_round >= 0 else events


def main() -> int:
    events = _load_current_round()
    writes = [e for e in events if e.get("event") == "file_written"]
    prods = [e for e in events if e.get("event") == "productive_incoherence"]
    total = len(writes) or 1  # avoid div-by-zero
    rate = len(prods) / total

    if rate < 0.1:
        regime = "exploit"
        suggestion = "Exploration rate low. Consider targeting KB-uncovered modules or running `learn()` on recent edits."
    elif rate > 0.4:
        regime = "explore"
        suggestion = "Exploration rate high. Consider consolidating — run `learn()` to capture findings; re-read KB for recently-edited modules."
    else:
        regime = "balanced"
        suggestion = ""

    OUT_TXT.parent.mkdir(parents=True, exist_ok=True)
    OUT_TXT.write_text(f"{rate:.3f} {regime}\n")

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps({
        "generated_at": int(time.time()),
        "rate": rate,
        "writes": len(writes),
        "productive_incoherence": len(prods),
        "regime": regime,
        "suggestion": suggestion,
    }, indent=2))

    print(f"exploration-rate: {rate:.3f} ({regime})  writes={len(writes)} productive={len(prods)}")
    if suggestion:
        print(f"  → {suggestion}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
