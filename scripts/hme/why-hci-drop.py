#!/usr/bin/env python3
"""i/why mode=hci-drop — explain HCI score regression.

Reads the timeseries to find the most recent rows where HCI dropped, then
diffs the verifier set across that drop to surface which verifier(s)
caused it. Stronger than mode=hci-diff (which only compares last vs
.prev snapshots) — this scans further back to find a regression even if
several runs have happened since.
"""
from __future__ import annotations
import json
import os
import sys
from datetime import datetime

from _common import PROJECT_ROOT


def main(argv):
    ts_path = os.path.join(PROJECT_ROOT, "output", "metrics",
                           "hme-coherence-timeseries.jsonl")
    if not os.path.isfile(ts_path):
        print("# i/why mode=hci-drop")
        print("No timeseries file at output/metrics/hme-coherence-timeseries.jsonl.")
        return 1

    try:
        with open(ts_path) as f:
            rows = [json.loads(ln) for ln in f if ln.strip()]
    except (OSError, ValueError) as e:
        print(f"# i/why mode=hci-drop\nFailed to read timeseries: {e}")
        return 1

    if len(rows) < 2:
        print("# i/why mode=hci-drop")
        print(f"Only {len(rows)} run(s) recorded — need ≥2 to compute drops.")
        return 0

    # Find the most-recent drop (current row's HCI < some earlier row's max)
    current = rows[-1]
    cur_hci = current.get("hci")
    if cur_hci is None:
        print("# i/why mode=hci-drop")
        print("Current row has no HCI score.")
        return 0

    # Look back to find the highest HCI in the last 30 runs
    recent = rows[-30:]
    peak = max(recent, key=lambda r: r.get("hci", 0))
    if peak is current or peak.get("hci", 0) <= cur_hci:
        print("# i/why mode=hci-drop")
        print(f"  Current HCI ({cur_hci}) is at or above recent peak — no drop to explain.")
        print(f"  Recent peak: {peak.get('hci')} at {datetime.fromtimestamp(peak.get('ts', 0)).strftime('%Y-%m-%d %H:%M')}")
        return 0

    # We have a drop: peak → current. Diff their probes.
    peak_probes = peak.get("probes", {})
    cur_probes = current.get("probes", {})
    regressed = []  # was-PASS now-FAIL/WARN
    for name in sorted(set(peak_probes) | set(cur_probes)):
        p_status = peak_probes.get(name, {}).get("status")
        c_status = cur_probes.get(name, {}).get("status")
        if p_status == "PASS" and c_status in ("FAIL", "WARN", "ERROR"):
            regressed.append((name, p_status, c_status,
                              cur_probes.get(name, {}).get("detail", "")[:80]))

    print(f"# i/why mode=hci-drop")
    print(f"  HCI: {peak.get('hci')} (peak, {datetime.fromtimestamp(peak.get('ts', 0)).strftime('%H:%M')}) → {cur_hci} (now)")
    print(f"  Drop of {peak.get('hci') - cur_hci} points across {len(rows[rows.index(peak):]) - 1} run(s).")
    print()
    if regressed:
        print(f"  Regressed verifiers ({len(regressed)}):")
        for name, p, c, detail in regressed:
            print(f"    {name:36}  {p} → {c}  {detail}")
    else:
        print("  (no PASS-to-FAIL transitions; drop is likely score-only — use mode=verifier <name> for the lowest-scoring ones)")
    print()
    print("# Next:")
    print("  i/why mode=verifier <name>           inspect a regressed verifier")
    print("  i/status mode=hci-diff               last-2-snapshot view")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
