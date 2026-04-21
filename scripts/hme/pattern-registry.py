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

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PATTERNS_DIR = os.path.join(PROJECT_ROOT, "tools", "HME", "patterns")
MATCHES = os.path.join(PROJECT_ROOT, "metrics", "hme-pattern-matches.json")


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
        print(f"Matched this round: {matches.get('matches_count', 0)}/{matches.get('patterns_total', 0)}")
        for m in (matches.get("matches") or []):
            print(f"  [{m.get('category')}] {m.get('id')}")
            print(f"    payload: {m.get('payload', '')[:120]}")
            print(f"    action: {m.get('action_summary', '')}")
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
