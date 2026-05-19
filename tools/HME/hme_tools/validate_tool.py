#!/usr/bin/env python3
"""Validate a canonical smolagents/HME tool payload."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from hme_tools.base import missing_required_inputs  # type: ignore
    from hme_tools.tools import tool_by_name  # type: ignore
else:
    from .base import missing_required_inputs
    from .tools import tool_by_name


def read_payload(args: argparse.Namespace) -> dict[str, Any]:
    if args.json:
        data = sys.stdin.read() or "{}"
    else:
        data = args.payload or "{}"
    parsed = json.loads(data)
    return parsed if isinstance(parsed, dict) else {}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("name", help="Bare tool name, e.g. Read or Bash")
    parser.add_argument("payload", nargs="?", default="{}")
    parser.add_argument("--json", action="store_true", help="Read JSON payload from stdin")
    parsed = parser.parse_args(argv)
    os.environ.setdefault("PROJECT_ROOT", str(Path(__file__).resolve().parents[2]))
    tool = tool_by_name(parsed.name)
    payload = read_payload(parsed)
    missing = missing_required_inputs(tool, payload)
    result = {
        "name": tool.name,
        "ok": not missing,
        "missing": missing,
        "approval": tool.approval,
        "requires_approval": bool(getattr(tool, "requires_approval", lambda _payload: tool.approval == "always")(payload)),
        "hme": tool.hme_metadata(),
    }
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
