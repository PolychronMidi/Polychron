"""Canonical metadata factory for HME server tools."""
from __future__ import annotations

import inspect
import logging
import json
from pathlib import Path

from hme_env import ENV
from typing import Any


PROJECT_ROOT = Path(ENV.optional("PROJECT_ROOT", "") or Path(__file__).resolve().parents[4])
INVOCATIONS_PATH = PROJECT_ROOT / "tools" / "HME" / "config" / "tool-invocations.json"
logger = logging.getLogger("HME")


def _invocation_surface() -> dict[str, Any]:
    try:
        data = json.loads(INVOCATIONS_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.debug(f"tool invocation metadata read failed: {type(exc).__name__}: {exc}")
        return {}
    tools = data.get("tools", {})
    return tools if isinstance(tools, dict) else {}


def tool_metadata(fn, raw: dict[str, Any] | None = None) -> dict[str, Any]:
    raw = dict(raw or {})
    invocations = _invocation_surface()
    name = raw.pop("name", fn.__name__)
    invocation = invocations.get(name, {})
    hidden = bool(raw.pop("hidden", invocation.get("hidden", False)))
    public = bool(raw.pop("public", invocation.get("public", not hidden)))
    return {
        "name": name,
        "mode": raw.pop("mode", "sync"),
        "public": public,
        "hidden": hidden,
        "docstring": inspect.getdoc(fn) or "",
        "i_surface": raw.pop("i_surface", invocation.get("i_surface") or invocation.get("i", "")),
        "permissions": raw.pop("permissions", invocation.get("permissions", [])),
        "lifecycle": raw.pop("lifecycle", raw.pop("status", invocation.get("lifecycle", "active"))),
        "tests": raw.pop("tests", invocation.get("tests", [])),
        **raw,
    }
