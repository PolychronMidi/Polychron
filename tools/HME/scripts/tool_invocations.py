"""Helper for canonical tool-invocation lookup.

Single source of truth for translating internal MCP tool names → user-facing
forms. Read tools/HME/config/tool-invocations.json once at import time;
expose `i_form(mcp_name)` and `action_form(action)` so error messages,
selftest hints, primer examples etc. converge on one rendering instead of
hand-duplicating the translation across dozens of files.

Usage:
    from tool_invocations import i_form, action_form
    msg = f"run {i_form('hme_admin')} action=warm"   # → "run i/hme-admin action=warm"
    msg = f"fix: {action_form('clear_index')}"        # → "fix: i/hme-admin action=clear_index"
"""
from __future__ import annotations

import json
import os
import re

_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "config", "tool-invocations.json",
)


def _load() -> dict:
    try:
        with open(_CONFIG_PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"tools": {}, "actions": {}}


_DATA = _load()


def i_form(mcp_name: str, primer: bool = False, value: str = "") -> str:
    """Return the user-facing `i/<wrapper>` form for an MCP tool name.

    - default: `i/<wrapper> <key>=<MODE>` (template form with placeholder)
    - `primer=True`: doc-style form with the canonical example value
      (e.g. `i/status mode=hme`, `i/evolve focus=design`)
    - `value=...`: substitute the placeholder with a concrete value
      (e.g. `i_form('status', value='signals')` → `i/status mode=signals`)
    """
    entry = _DATA.get("tools", {}).get(mcp_name)
    if not entry:
        base = f"i/{mcp_name.replace('_', '-')}"
        return f"{base} mode={value}" if value else base
    template = entry.get("primer" if primer else "i", f"i/{mcp_name}")
    if value:
        # Substitute the angle-bracket placeholder if present (e.g. <MODE>,
        # <ACTION>, <FOCUS>, <TARGET>). Falls through to template if no
        # placeholder — caller gets the original string back.
        return re.sub(r"<[A-Z_]+>", value, template, count=1)
    return template


def action_form(action: str) -> str:
    """Return the canonical invocation for a known hme-admin action."""
    return _DATA.get("actions", {}).get(action, f"i/hme-admin action={action}")


def reload() -> None:
    """Re-read the JSON (called by code that mutates the file)."""
    global _DATA
    _DATA = _load()
