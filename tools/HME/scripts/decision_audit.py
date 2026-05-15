#!/usr/bin/env python3
"""Summarise architectural-edit audit rows from decision-audit.jsonl."""
from __future__ import annotations

import json
import os
import sys
from collections import Counter


def main(argv: list[str]) -> int:
    project_root = os.environ.get("PROJECT_ROOT") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    log = os.path.join(project_root, "output", "metrics", "decision-audit.jsonl")
    if not os.path.isfile(log):
        print(f"decision-audit: no log at {log} (no architectural edits yet)")
        return 0

    total = 0
    reviewed = 0
    by_file: Counter[str] = Counter()
    recent: list[dict] = []
    with open(log, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            total += 1
            if row.get("reviewed") or row.get("consulted"):
                reviewed += 1
            by_file[row.get("file", "?")] += 1
            recent.append(row)

    rate = (reviewed / total * 100.0) if total else 0.0
    print(f"decision-audit: {total} architectural edit(s) total, {reviewed} with review record ({rate:.1f}%)")
    print()
    print("most-touched architectural files:")
    for path, count in by_file.most_common(5):
        print(f"  {count:>3}  {path}")
    print()
    print("most recent (last 10):")
    for row in recent[-10:]:
        flag = "R" if (row.get("reviewed") or row.get("consulted")) else " "
        print(f"  [{flag}] {row.get('ts', '?')}  {row.get('file', '?')}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
