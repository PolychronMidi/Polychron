#!/usr/bin/env python3
"""Generic PreToolUse mirror for transcript-scope Stop detectors.

Reads the Claude Code PreToolUse hook payload on stdin, iterates every
registry entry with a `pre_tool_use_mirror` block, and prints a JSON deny
verdict for the first one whose predicate fires. Exits 0 always (the bash
gate captures stdout and forwards to Claude Code).

Each pre_tool_use_mirror block shape:
    {
      "tool": "Bash",
      "predicate_fn": "<function_name in the detector module>",
      "deny_reason": "<text>",
      "override_env": "<optional env var that disables the gate>"
    }

The predicate function takes (cmd: str, transcript_path: str) and returns
True to deny, False to allow. It MUST be defined in the detector's module
(import path: tools/HME/scripts/detectors/<module>.py).
"""
from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path

REGISTRY_PATH = Path(__file__).parent / "registry.json"


def _load_registry() -> list[dict]:
    try:
        data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    return data.get("detectors", []) if isinstance(data, dict) else []


def _emit_deny(reason: str) -> None:
    sys.stdout.write(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }))


def _read_hook_payload() -> dict:
    try:
        raw = sys.stdin.read() or "{}"
        return json.loads(raw)
    except Exception:
        return {}


def _tool_name(payload: dict) -> str:
    return str(payload.get("tool_name") or "")


def _bash_cmd(payload: dict) -> str:
    tool_input = payload.get("tool_input") or {}
    return str(tool_input.get("command") or "")


def _resolve_predicate(module_name: str, fn_name: str):
    try:
        mod = importlib.import_module(module_name)
    except Exception:
        return None
    return getattr(mod, fn_name, None)


def main() -> int:
    payload = _read_hook_payload()
    transcript = payload.get("transcript_path") or ""
    if not transcript or not os.path.isfile(transcript):
        return 0
    detectors = _load_registry()
    sys.path.insert(0, str(Path(__file__).parent))
    for entry in detectors:
        mirror = entry.get("pre_tool_use_mirror")
        if not mirror or not isinstance(mirror, dict):
            continue
        if mirror.get("tool") != _tool_name(payload):
            continue
        override = mirror.get("override_env")
        if override and os.environ.get(override) == "1":
            continue
        fn = _resolve_predicate(entry.get("module") or "", mirror.get("predicate_fn") or "")
        if not callable(fn):
            continue
        verdict = fn(_bash_cmd(payload), transcript)
        if verdict:
            reason = verdict if isinstance(verdict, str) else (mirror.get("deny_reason") or f"{entry.get('reason_key', 'PRE_TOOL_USE_DENY')}")
            _emit_deny(reason)
            return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
