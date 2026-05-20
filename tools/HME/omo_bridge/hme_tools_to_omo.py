"""Convert canonical HME LangChain tool descriptors to OMO-facing shape."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
MUTATING_EFFECTS = {"write", "edit", "shell", "network", "agent"}


def canonical_langchain_tools() -> list[dict]:
    script = PROJECT_ROOT / "tools" / "HME" / "hme_tools" / "export.py"
    proc = subprocess.run(
        ["python3", str(script), "--kind", "langchain"],
        cwd=str(PROJECT_ROOT),
        env={**os.environ, "PROJECT_ROOT": str(PROJECT_ROOT), "HME_SOURCE_ROOT": str(PROJECT_ROOT)},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "HME tool export failed").strip())
    return json.loads(proc.stdout or "[]")


def to_omo_tool_descriptor(tool: dict) -> dict:
    metadata = dict(tool.get("metadata") or {})
    side_effect = metadata.get("side_effect", "unknown")
    metadata.update({
        "hme_bridge": "omo",
        "bridge_action": metadata.get("bridge_action") or tool.get("name"),
        "mutating": side_effect in MUTATING_EFFECTS,
        "hme_policy_authority": True,
    })
    return {
        "name": tool.get("name", ""),
        "description": tool.get("description", ""),
        "input_schema": tool.get("args_schema") or {"type": "object", "properties": {}, "required": []},
        "metadata": metadata,
    }


def hme_tools_for_omo(tools: list[dict] | None = None) -> list[dict]:
    return [to_omo_tool_descriptor(t) for t in (tools if tools is not None else canonical_langchain_tools())]
