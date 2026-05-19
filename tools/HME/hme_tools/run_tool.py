#!/usr/bin/env python3
"""Execute a canonical smolagents/HME tool by bare name."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from hme_tools.tools import tool_by_name  # type: ignore
else:
    from .tools import tool_by_name


def read_payload(args: argparse.Namespace) -> dict:
    if args.json:
        return json.loads(sys.stdin.read() or "{}")
    return json.loads(args.payload or "{}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("name", help="Bare tool name, e.g. Read or Bash")
    parser.add_argument("payload", nargs="?", default="{}")
    parser.add_argument("--json", action="store_true", help="Read JSON payload from stdin")
    parsed = parser.parse_args(argv)
    os.environ.setdefault("PROJECT_ROOT", str(Path(__file__).resolve().parents[2]))
    tool = tool_by_name(parsed.name)
    payload = read_payload(parsed)
    try:
        result = tool(payload)
    except Exception as exc:  # explicit top-level tool error surface
        print(str(exc), file=sys.stderr)
        return 1
    if isinstance(result, str):
        print(result)
    else:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
