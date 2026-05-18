"""Behavioral-antipattern detector base class.

Stop-hook detectors and PreToolUse mirrors share the same shape: read the
current turn from the transcript, evaluate a predicate, return a verdict.
This base eliminates the per-detector dispatcher/parser boilerplate and
unifies the registry contract.

Subclasses set:
    name        -- snake_case, matches registry.json entry
    phases      -- list, subset of {'stop', 'pre_tool_use'}
    severity    -- 'warn' or 'block'
    bypass_env  -- optional env var name; when "1" the detector is silent

And implement:
    predicate(self, ctx) -> bool
        Returns True if the antipattern is happening NOW.
        ctx is a SimpleNamespace with:
            ctx.transcript_path : str | None
            ctx.tool_name       : str | None   (pre_tool_use only)
            ctx.tool_input      : dict | None  (pre_tool_use only)
            ctx.events          : list of events (lazily loaded)

The base provides .stop_main(path) and .pre_tool_use_main() that handle
the I/O, fail-open on parser errors, and emit the registry's reason text.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from _transcript import load_turn_events  # noqa: E402


class BehavioralDetector:
    name: str = ""
    phases: list[str] = ["stop"]
    severity: str = "warn"
    bypass_env: str | None = None
    reason_text: str = ""

    def predicate(self, ctx: SimpleNamespace) -> bool:
        raise NotImplementedError

    def _bypassed(self) -> bool:
        return bool(self.bypass_env and os.environ.get(self.bypass_env) == "1")

    def _build_ctx(self, transcript_path: str, hook_payload: dict | None = None) -> SimpleNamespace:
        events: list[dict] = []
        if transcript_path and os.path.isfile(transcript_path):
            try:
                events = list(load_turn_events(transcript_path))
            except Exception:
                events = []
        ti = (hook_payload or {}).get("tool_input") if hook_payload else None
        return SimpleNamespace(
            transcript_path=transcript_path,
            tool_name=(hook_payload or {}).get("tool_name") if hook_payload else None,
            tool_input=ti,
            events=events,
        )

    def stop_main(self, transcript_path: str) -> int:
        """Stop-hook entry point: prints `<name>` if the detector fires,
        `ok` otherwise. Always exits 0 (failures fail-open)."""
        if "stop" not in self.phases or self._bypassed():
            print("ok"); return 0
        try:
            ctx = self._build_ctx(transcript_path)
            fired = bool(self.predicate(ctx))
        except Exception:
            fired = False
        print(self.name if fired else "ok")
        return 0

    def pre_tool_use_main(self) -> int:
        """PreToolUse entry point: reads JSON payload from stdin and prints a
        deny envelope if the detector fires. Always exits 0."""
        if "pre_tool_use" not in self.phases or self._bypassed():
            return 0
        try:
            raw = sys.stdin.read() or "{}"
            payload = json.loads(raw)
        except Exception:
            return 0
        try:
            ctx = self._build_ctx(payload.get("transcript_path") or "", payload)
            fired = bool(self.predicate(ctx))
        except Exception:
            fired = False
        if fired:
            sys.stdout.write(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": self.reason_text or self.name.upper(),
                },
            }))
        return 0
