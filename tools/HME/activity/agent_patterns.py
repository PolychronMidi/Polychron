#!/usr/bin/env python3
"""Cross-session agent-pattern DB.

Single append-only JSONL at output/metrics/hme-agent-patterns.jsonl.
Every session contributes signatures about the agent's behavior in that
session — tool-count histograms, deferral phrases seen, race outcomes,
review cleanliness, hook-latency p95. These accumulate across sessions
so:

  - Drift detection: "this agent said 'banked for later' 2× / session in
    the last month" is visible cumulatively.
  - Priors for the next session: sessionstart can read this and warn
    the agent "your last 5 sessions had p95>600ms on stop.sh — expect
    slow turns until you profile it."

MVP API:
  record(signature: str, value: dict) → append one line
  recent(signature: str, n: int) → list of last-n value dicts

CLI:
  agent_patterns.py record <signature> <json>    # stdin ok via -
  agent_patterns.py query <signature> [--n 10]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path


ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parent.parent.parent.parent)
DB = ROOT / "output" / "metrics" / "hme-agent-patterns.jsonl"


def record(signature: str, value: dict) -> None:
    DB.parent.mkdir(parents=True, exist_ok=True)
    entry = {"ts": int(time.time()), "sig": signature, "value": value}
    with open(DB, "a") as f:
        f.write(json.dumps(entry) + "\n")


def recent(signature: str, n: int = 10) -> list[dict]:
    if not DB.is_file():
        return []
    matches: list[dict] = []
    for raw in DB.read_text(encoding="utf-8", errors="replace").splitlines():
        if not raw.strip():
            continue
        try:
            e = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if e.get("sig") == signature:
            matches.append(e)
    return matches[-n:]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    rec = sub.add_parser("record")
    rec.add_argument("signature")
    rec.add_argument("value_json", help="JSON dict or - for stdin")

    q = sub.add_parser("query")
    q.add_argument("signature")
    q.add_argument("--n", type=int, default=10)

    args = ap.parse_args()

    if args.cmd == "record":
        raw = sys.stdin.read() if args.value_json == "-" else args.value_json
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as e:
            print(f"invalid JSON value: {e}", file=sys.stderr)
            return 1
        if not isinstance(value, dict):
            print("value must be a JSON object", file=sys.stderr)
            return 1
        record(args.signature, value)
        print(f"recorded {args.signature}")
    elif args.cmd == "query":
        matches = recent(args.signature, n=args.n)
        print(json.dumps(matches, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
