#!/usr/bin/env python3
"""i/pattern — query the pattern registry.

Usage:
  i/pattern                # list all patterns
  i/pattern <id>           # show full pattern
  i/pattern matched        # show currently-matched patterns
  i/pattern history        # show pattern match history (TODO: requires hme-pattern-history.jsonl)
"""
from __future__ import annotations
import glob
import json
import os
import sys

from _common import PROJECT_ROOT, METRICS_DIR

PATTERNS_DIR = os.path.join(PROJECT_ROOT, "tools", "HME", "patterns")
MATCHES = os.path.join(METRICS_DIR, "hme-pattern-matches.json")


def _load_patterns():
    out = []
    for p in sorted(glob.glob(os.path.join(PATTERNS_DIR, "*.json"))):
        try:
            with open(p) as f:
                out.append((p, json.load(f)))
        except Exception:
            continue
    return out


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "list"
    if cmd == "list":
        patterns = _load_patterns()
        print(f"Pattern registry ({len(patterns)} patterns):\n")
        for path, p in patterns:
            print(f"  [{p.get('category', '?')}] {p.get('id', '?')}")
            desc = p.get("description", "")[:100]
            if desc:
                print(f"      {desc}")
        return 0
    if cmd == "matched":
        matches = {}
        if os.path.isfile(MATCHES):
            with open(MATCHES) as f:
                matches = json.load(f)
        n_matched = matches.get('matches_count', 0)
        n_total = matches.get('patterns_total', 0)
        print(f"Matched this round: {n_matched}/{n_total}")
        for m in (matches.get("matches") or []):
            print(f"  [{m.get('category')}] {m.get('id')}")
            print(f"    payload: {m.get('payload', '')[:120]}")
            print(f"    action: {m.get('action_summary', '')}")
        # When nothing matched, surface why instead of leaving the user
        # staring at "0/N". Patterns are condition-gated; show the gate
        # condition for each registered pattern so it's clear what would
        # need to happen for a match.
        if n_matched == 0 and n_total > 0:
            print("\nNo patterns matched this round. Trigger conditions:")
            for _, p in _load_patterns():
                pid = p.get("id", "?")
                trig = p.get("trigger_when") or p.get("when") or p.get("condition")
                if isinstance(trig, dict):
                    trig = "; ".join(f"{k}={v}" for k, v in trig.items())[:140]
                elif isinstance(trig, list):
                    trig = "; ".join(str(t) for t in trig)[:140]
                else:
                    trig = (str(trig) if trig else "(no `trigger_when` declared)")
                print(f"  [{p.get('category', '?')}] {pid}")
                print(f"    when: {trig}")
            print("\nInspect the full pattern with: i/pattern <id>")
            print("Compute fresh matches with: node scripts/pipeline/hme/match-patterns.js")
        return 0
    # Otherwise treat as pattern id
    for _, p in _load_patterns():
        if p.get("id") == cmd:
            print(json.dumps(p, indent=2))
            return 0
    print(f"pattern '{cmd}' not found; try: i/pattern list", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
