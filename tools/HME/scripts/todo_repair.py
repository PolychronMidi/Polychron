#!/usr/bin/env python3
"""Repair doc/templates/TODO.md from tools/HME/KB/todos.json."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

PROJECT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3])
SERVICE = PROJECT / "tools" / "HME" / "service"
if str(SERVICE) not in sys.path:
    sys.path.insert(0, str(SERVICE))

from server.tools_analysis.todo_md_sync import (  # noqa: E402
    repair_todo_md_from_store,
)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="exit 1 if TODO.md would change")
    parser.add_argument("--json", action="store_true", help="print machine-readable result")
    args = parser.parse_args(argv)

    result = repair_todo_md_from_store(write=not args.check)
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        state = "changed" if result["changed"] else "already synced"
        print(f"todo-repair: {state}: {result['path']} ({result['todo_count']} top-level todo(s))")
    return 1 if args.check and result["changed"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
