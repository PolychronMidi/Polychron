"""Canonical metadata factory for HME server tools."""
from __future__ import annotations

import inspect
import json
import os
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(
    os.environ.get("PROJECT_ROOT")
    or os.environ.get("CLAUDE_PROJECT_DIR")
    or Path(__file__).resolve().parents[4]
)
INVOCATIONS_PATH = PROJECT_ROOT / "tools" / "HME" / "config" / "tool-invocations.json"


def _invocation_surface() -> dict[str, Any]:
    try:
        data = json.loads(INVOCATIONS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    tools = data.get("tools", {})
    return tools if isinstance(tools, dict) else {}


def tool_metadata(fn, raw: dict[str, Any] | None = None) -> dict[str, Any]:
    raw = dict(raw or {})
    hidden = bool(raw.pop("hidden", False))
    invocations = _invocation_surface()
    public = bool(raw.pop("public", not hidden))
    name = raw.pop("name", fn.__name__)
    return {
        "name": name,
        "mode": raw.pop("mode", "sync"),
        "public": public,
        "hidden": hidden,
        "docstring": inspect.getdoc(fn) or "",
        "i_surface": raw.pop("i_surface", invocations.get(name, {}).get("i_surface", "")),
        "permissions": raw.pop("permissions", invocations.get(name, {}).get("permissions", [])),
        "lifecycle": raw.pop("lifecycle", raw.pop("status", "active")),
        "tests": raw.pop("tests", invocations.get(name, {}).get("tests", [])),
        **raw,
    }
