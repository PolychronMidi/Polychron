#!/usr/bin/env python3
"""H15: HME-as-compose-layer bridge.

Emits the current HME Coherence Index as a structured signal file that
Polychron's composition layer can optionally consume. This is the first
half of the co-evolution loop promised in the vision doc: HME's self-
coherence state becomes a signal available to the music pipeline.

The signal lives in metrics/hme-composition-signal.json and contains:
  - hci: current aggregate 0-100
  - hci_normalized: 0.0-1.0 for direct use as a multiplier
  - category_scores: per-category 0.0-1.0
  - interpretation: suggested compositional effect
    - hci > 95 → "stable/assured" (stronger cadence resolution)
    - hci 80-95 → "normal" (no modulation)
    - hci 60-80 → "searching/uncertain" (slight dissonance)
    - hci < 60 → "disturbed" (noticeable degradation)

CRITICAL: this is a one-way read-only signal. HME writes it; composition
modules may or may not consume it. The firewall port is declared in
metrics/feedback_graph.json under firewallPorts as "hci_composition_signal"
with direction=hme→composition.

This file does NOT auto-activate the signal in any compositional module.
Enabling the signal requires:
  1. A composition module (e.g. src/crossLayer/structure/form/*) that
     imports the signal file and maps hci_normalized to one of its axes
  2. The new coupling declared in metrics/feedback_graph.json and
     validated by scripts/validate-feedback-graph.js
  3. A biasBoundsSnapshot update via check-hypermeta-jurisdiction.js

Until those steps happen, the signal is INFORMATIONAL — written but unread.
That's intentional: H15 puts the pipe in place without changing any existing
musical behavior. Activation is a conscious future choice.

Usage:
    python3 tools/HME/scripts/emit-hci-signal.py
"""
import json
import os
import subprocess
import sys
import time

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_SIGNAL = os.path.join(METRICS_DIR, "hme-composition-signal.json")


def _get_hci() -> dict:
    script = os.path.join(_PROJECT, "tools", "HME", "scripts", "verify-coherence.py")
    try:
        rc = subprocess.run(
            ["python3", script, "--json"],
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "PROJECT_ROOT": _PROJECT},
        )
        return json.loads(rc.stdout)
    except Exception as e:
        sys.stderr.write(f"HCI fetch failed: {e}\n")
        return {}


def interpret(hci: float) -> str:
    if hci >= 95:
        return "stable"
    if hci >= 80:
        return "normal"
    if hci >= 60:
        return "searching"
    return "disturbed"


def main() -> int:
    hci_data = _get_hci()
    if not hci_data:
        return 2
    hci_score = float(hci_data.get("hci", 100))
    cats = hci_data.get("categories", {})
    signal = {
        "generated_at": time.time(),
        "hci": hci_score,
        "hci_normalized": hci_score / 100.0,
        "category_scores": {k: v.get("score", 0) for k, v in cats.items()},
        "interpretation": interpret(hci_score),
        "firewall_port": "hci_composition_signal",
        "direction": "hme→composition",
        "read_only": True,
        "consumers": [],  # filled by future composition modules
        "note": (
            "This is an informational signal. Composition modules may consume "
            "hci_normalized as a bias input, but doing so requires declaring a "
            "new coupling in metrics/feedback_graph.json and passing the "
            "hypermeta jurisdiction check. Until then, this signal is unread."
        ),
    }
    os.makedirs(os.path.dirname(_SIGNAL), exist_ok=True)
    with open(_SIGNAL, "w") as f:
        json.dump(signal, f, indent=2)
    print(f"HCI composition signal: {_SIGNAL}")
    print(f"  hci={hci_score} normalized={signal['hci_normalized']:.3f} interpretation={signal['interpretation']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
