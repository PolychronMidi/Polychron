#!/usr/bin/env python3
"""Strip retired legacy-override ids from metrics/legacy-override-history.jsonl.

R17 #8: After retirement, historical rows still contain entries like
{"entropy-cap-0.19": 0} in fires/entries dicts. These clutter trend
analysis (every consumer sees the retired id forever). This one-shot
script rewrites each row with retired ids removed.

Retired ids come from metrics/legacy-override-retirement-log.jsonl
(entries WITHOUT action:"keep" — those are explicit keepers).

Usage:
  python3 scripts/prune-retired-from-override-history.py [--dry-run]
"""
from __future__ import annotations
import json
import os
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HIST = os.path.join(ROOT, "metrics", "legacy-override-history.jsonl")
RETIRE = os.path.join(ROOT, "metrics", "legacy-override-retirement-log.jsonl")


def main():
    dry_run = "--dry-run" in sys.argv
    if not os.path.isfile(HIST):
        print("prune: history file missing — nothing to do")
        return 0
    retired = set()
    if os.path.isfile(RETIRE):
        with open(RETIRE, encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s:
                    continue
                try:
                    e = json.loads(s)
                except Exception:
                    continue
                if e.get("action") == "keep":
                    continue
                if e.get("id"):
                    retired.add(e["id"])
    if not retired:
        print("prune: no retired ids found")
        return 0
    print(f"prune: retired ids to strip = {sorted(retired)}")

    rewritten = 0
    kept_lines = []
    with open(HIST, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            try:
                row = json.loads(s)
            except Exception:
                kept_lines.append(line)
                continue
            modified = False
            for key in ("fires", "entries"):
                d = row.get(key) or {}
                for rid in list(d.keys()):
                    if rid in retired:
                        del d[rid]
                        modified = True
            if modified:
                rewritten += 1
                kept_lines.append(json.dumps(row) + "\n")
            else:
                kept_lines.append(line)

    print(f"prune: {rewritten} rows would be rewritten")
    if dry_run or rewritten == 0:
        return 0

    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(HIST), prefix=".hist-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tf:
            tf.writelines(kept_lines)
        os.replace(tmp, HIST)
    except Exception:
        if os.path.isfile(tmp):
            os.unlink(tmp)
        raise
    print(f"prune: {rewritten} rows rewritten")
    return 0


if __name__ == "__main__":
    sys.exit(main())
