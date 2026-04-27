#!/usr/bin/env python3
"""i/why mode=verifier <name> — explain why a verifier is in its current
status by surfacing source + recent timeseries.

Reads:
- output/metrics/hci-verifier-snapshot.json (current status)
- output/metrics/hme-coherence-timeseries.jsonl (last 3 runs of this verifier)
- tools/HME/scripts/verify_coherence/*.py (the verifier's source)

Output: status + score + last-3 results + first ~30 lines of the
verifier's source so the user can read what it actually checks.
"""
from __future__ import annotations
import json
import os
import re
import sys

from _common import PROJECT_ROOT


def _read_json(path: str) -> dict | None:
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _find_verifier_source(name: str) -> tuple[str, list[str]] | None:
    """Walk verify_coherence/ for class with this name attr; return (path, source_lines)."""
    pkg = os.path.join(PROJECT_ROOT, "tools", "HME", "scripts",
                       "verify_coherence")
    name_re = re.compile(rf'^\s*name = "{re.escape(name)}"\s*$', re.MULTILINE)
    for root, _dirs, files in os.walk(pkg):
        for f in files:
            if not f.endswith(".py"):
                continue
            p = os.path.join(root, f)
            try:
                with open(p) as fp:
                    src = fp.read()
            except OSError:
                continue
            m = name_re.search(src)
            if not m:
                continue
            # Find the class definition (walk back to nearest "class ")
            lines = src.splitlines()
            line_idx = src[:m.start()].count("\n")
            for i in range(line_idx, -1, -1):
                if lines[i].lstrip().startswith("class "):
                    end = min(i + 30, len(lines))
                    return (p, lines[i:end])
            return (p, lines[max(0, line_idx - 5):line_idx + 25])
    return None


def main(argv):
    # mode=verifier <name>  OR  mode=verifier name=<x>
    name = ""
    for a in argv[1:]:
        if a.startswith("name="):
            name = a.split("=", 1)[1]
        elif a in ("mode=verifier",) or a.startswith("mode="):
            continue
        else:
            name = a
    if not name:
        print("Usage: i/why mode=verifier <verifier-name>", file=sys.stderr)
        print("  e.g. i/why mode=verifier doc-drift", file=sys.stderr)
        return 2

    snap = _read_json(os.path.join(PROJECT_ROOT, "output", "metrics",
                                   "hci-verifier-snapshot.json"))
    if not snap:
        print(f"# i/why mode=verifier {name}")
        print("No snapshot found — run `python3 tools/HME/scripts/verify-coherence.py` first.")
        return 1
    entry = snap.get("verifiers", {}).get(name)
    if not entry:
        from difflib import get_close_matches
        all_names = sorted(snap.get("verifiers", {}).keys())
        suggestions = get_close_matches(name, all_names, n=3, cutoff=0.5)
        print(f"# i/why mode=verifier {name}")
        print(f"  '{name}' not found in current snapshot.")
        if suggestions:
            print(f"  did you mean: {', '.join(suggestions)}?")
        return 1

    print(f"# i/why mode=verifier {name}")
    print()
    print(f"  current: {entry.get('status')} score={entry.get('score', 0):.3f}")

    # Last 3 runs from timeseries
    ts_path = os.path.join(PROJECT_ROOT, "output", "metrics",
                           "hme-coherence-timeseries.jsonl")
    if os.path.isfile(ts_path):
        try:
            with open(ts_path) as f:
                rows = f.readlines()[-50:]
        except OSError:
            rows = []
        history = []
        for line in rows:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            probe = row.get("probes", {}).get(name)
            if probe:
                history.append((row.get("ts"), probe.get("status"), probe.get("detail", "")[:60]))
        if history:
            print()
            print(f"  last {min(3, len(history))} runs:")
            for ts, status, detail in history[-3:]:
                from datetime import datetime
                ts_str = datetime.fromtimestamp(ts).strftime("%H:%M:%S") if ts else "?"
                print(f"    {ts_str}  {status:5}  {detail}")

    # Source
    src_info = _find_verifier_source(name)
    if src_info:
        path, lines = src_info
        rel = os.path.relpath(path, PROJECT_ROOT)
        print()
        print(f"  source: {rel}")
        print()
        for i, line in enumerate(lines):
            print(f"    {line}")
    else:
        print()
        print(f"  source: (could not locate class for verifier '{name}')")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
