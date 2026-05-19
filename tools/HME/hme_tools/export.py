#!/usr/bin/env python3
"""Export canonical smolagents/HME tool schemas."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from hme_tools.base import langchain_tool_schema, openai_tool_schema  # type: ignore
    from hme_tools.tools import canonical_tools  # type: ignore
else:
    from .base import langchain_tool_schema, openai_tool_schema
    from .tools import canonical_tools


def schemas(kind: str) -> list[dict[str, Any]]:
    tools = canonical_tools()
    if kind in {"openai", "codex", "claude"}:
        return [openai_tool_schema(tool) for tool in tools]
    if kind == "langchain":
        return [langchain_tool_schema(tool) for tool in tools]
    if kind == "hme":
        return [tool.hme_schema() for tool in tools]
    raise ValueError(f"unknown schema kind: {kind}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=["openai", "codex", "claude", "langchain", "hme"], default="codex")
    parser.add_argument("--output", default="-")
    args = parser.parse_args(argv)
    data = schemas(args.kind)
    text = json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True)
    if args.output == "-":
        print(text)
    else:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
