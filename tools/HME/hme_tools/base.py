"""Canonical smolagents-based HME tool base.

Tool names intentionally stay bare (Read, Bash, Edit, ...). From the agent's
perspective these are native tools; HME policy/visibility metadata is attached
without renaming the surface.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    return Path(os.environ.get("HME_SOURCE_ROOT") or Path(__file__).resolve().parents[3])


_LOCAL_SMOLAGENTS = _repo_root() / "tools" / "smolagents" / "src"
if _LOCAL_SMOLAGENTS.is_dir():
    sys.path.insert(0, str(_LOCAL_SMOLAGENTS))

from smolagents import Tool
from smolagents.models import get_tool_json_schema


@dataclass(frozen=True)
class ToolVisibility:
    progress_label: str = "{name}"
    result_summary: str = "bytes"


@dataclass(frozen=True)
class ToolPolicy:
    side_effect: str = "none"
    approval: str = "never"
    idempotent: bool = True
    max_output_bytes: int = 200_000
    context_guard: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


class HMETool(Tool):
    """smolagents Tool enriched with HME execution/policy metadata."""

    side_effect: str = "none"
    approval: str = "never"
    idempotent: bool = True
    max_output_bytes: int = 200_000
    aliases: dict[str, str] = {}
    visibility: dict[str, Any] = {}
    policy: dict[str, Any] = {}

    def hme_metadata(self) -> dict[str, Any]:
        return {
            "side_effect": self.side_effect,
            "approval": self.approval,
            "idempotent": self.idempotent,
            "max_output_bytes": self.max_output_bytes,
            "aliases": dict(self.aliases),
            "visibility": dict(self.visibility),
            "policy": dict(self.policy),
        }

    def hme_schema(self) -> dict[str, Any]:
        schema = get_tool_json_schema(self)
        fn = schema.get("function", {})
        params = fn.get("parameters", {})
        params.setdefault("additionalProperties", False)
        return {
            "type": schema.get("type", "function"),
            "name": self.name,
            "description": self.description,
            "parameters": params,
            "output_type": self.output_type,
            "output_schema": getattr(self, "output_schema", None),
            "hme": self.hme_metadata(),
        }


def openai_tool_schema(tool: HMETool) -> dict[str, Any]:
    """OpenAI/Codex Responses tool schema with a bare native-looking name."""
    schema = get_tool_json_schema(tool)
    schema["function"]["parameters"].setdefault("additionalProperties", False)
    return {
        "type": "function",
        "name": schema["function"]["name"],
        "description": schema["function"]["description"],
        "parameters": schema["function"]["parameters"],
    }
