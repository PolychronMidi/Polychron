#!/usr/bin/env python3
"""Bridge helper for pretooluse_todowrite.sh.

Reads a TodoWrite tool_input payload on stdin, invokes the HME todo module's
merge_native_todowrite() function, and prints the merged list as JSON on
stdout. On any error, echoes the agent's original list so TodoWrite is
never broken by the hook.

This runs as a subprocess from the hook. It bypasses the MCP server
tools_analysis package __init__.py (which requires a live FastMCP instance)
by loading todo.py directly via importlib.util.

Env required:
  PROJECT_ROOT  — absolute path to the Polychron project root
"""
import importlib.util
import json
import os
import sys
import traceback
import types

_PROJECT = os.environ.get("PROJECT_ROOT") or "/home/jah/Polychron"
_TODO_PY = os.path.join(_PROJECT, "tools", "HME", "mcp", "server", "tools_analysis", "todo.py")

# Prefixes the hook adds when returning merged items back to native TodoWrite.
# When the agent echoes them on the next TodoWrite call, we strip them — they
# are not the agent's fresh intent, they're previous-round echoes.
_ECHO_PREFIXES = (
    "[CRITICAL] ",
    "[HME onboarding] ",
    "[LIFESAVER] ",
    "  └─ ",
    "  └─ [HME] ",
)


def _stub_server_namespace() -> None:
    """Install just enough fake infrastructure so todo.py loads cleanly
    without dragging in the full tools_analysis package __init__.py."""
    class _FakeMCP:
        @staticmethod
        def tool(**_kw):
            return lambda f: f

    sys.modules["server"] = types.ModuleType("server")
    sys.modules["server.context"] = types.SimpleNamespace(
        mcp=_FakeMCP(),
        PROJECT_ROOT=_PROJECT,
    )
    sys.modules["server.onboarding_chain"] = types.SimpleNamespace(
        chained=lambda _n: (lambda f: f)
    )

    ta_pkg = types.ModuleType("server.tools_analysis")
    ta_pkg.__path__ = [os.path.dirname(_TODO_PY)]
    ta_pkg._track = lambda *_a, **_kw: None
    sys.modules["server.tools_analysis"] = ta_pkg

    ss_pkg = types.ModuleType("server.tools_analysis.synthesis_session")
    ss_pkg.append_session_narrative = lambda *_a, **_kw: None
    sys.modules["server.tools_analysis.synthesis_session"] = ss_pkg


def _load_todo_module():
    spec = importlib.util.spec_from_file_location(
        "server.tools_analysis.todo", _TODO_PY
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["server.tools_analysis.todo"] = mod
    spec.loader.exec_module(mod)
    return mod


def _strip_echoes(items: list) -> list:
    cleaned = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        content = item.get("content", "")
        if any(content.startswith(p) for p in _ECHO_PREFIXES):
            continue
        cleaned.append(item)
    return cleaned


def main() -> int:
    raw = sys.stdin.read()
    fallback = "[]"
    try:
        payload = json.loads(raw)
    except Exception:
        payload = {}

    incoming = payload.get("tool_input", {}).get("todos", []) or []
    fallback = json.dumps(incoming)

    try:
        _stub_server_namespace()
        mod = _load_todo_module()
        cleaned = _strip_echoes(incoming)
        merged = mod.merge_native_todowrite(cleaned)
        print(json.dumps(merged))
        return 0
    except Exception as e:
        sys.stderr.write(f"HME todo merge error: {e}\n{traceback.format_exc()}")
        print(fallback)
        return 0  # Never fail — TodoWrite must still run


if __name__ == "__main__":
    sys.exit(main())
