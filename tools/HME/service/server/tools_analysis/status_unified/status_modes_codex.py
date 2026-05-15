"""Codex proxy visibility status modes."""
from __future__ import annotations

import json
import os

from server import context as ctx


def _iter_events(path: str, limit: int = 200) -> list[dict]:
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()[-limit:]
    except OSError:
        return []
    events: list[dict] = []
    for line in lines:
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    return events


def _fmt_delta(before: dict, after: dict) -> str:
    b = int(before.get("body_bytes", 0) or 0)
    a = int(after.get("body_bytes", 0) or 0)
    sign = "+" if a - b >= 0 else ""
    return f"{b}->{a} ({sign}{a - b})"


def _mode_codex_proxy() -> str:
    path = os.path.join(ctx.PROJECT_ROOT, "runtime", "hme", "codex-proxy-events.jsonl")
    requests = [e for e in _iter_events(path) if e.get("kind") == "request"][-20:]
    out = ["# Codex proxy payload visibility", ""]
    if not requests:
        out.append("No Codex proxy request events yet.")
        out.append(f"Log: {path}")
        return "\n".join(out)
    out.append("last 20 requests (no raw prompt text):")
    out.append("  ts                  model       bytes(delta)        instr  text   tools cleanup")
    for event in requests:
        payload_log = event.get("payload_log") or {}
        before = payload_log.get("before") or event.get("before") or {}
        after = payload_log.get("after") or event.get("after") or {}
        cleanup = event.get("cleanup") or {}
        cats = cleanup.get("categories") or {}
        cleanup_bits = ",".join(f"{k}={v}" for k, v in sorted(cats.items()) if v) or "none"
        out.append(
            f"  {str(event.get('ts', '?'))[:19]:19} "
            f"{str(after.get('model') or before.get('model') or '?')[:10]:10} "
            f"{_fmt_delta(before, after):18} "
            f"{int(after.get('instruction_bytes', 0) or 0):6} "
            f"{int(after.get('text_bytes', 0) or 0):6} "
            f"{int(after.get('tool_count', 0) or 0):5} "
            f"{cleanup_bits}"
        )
    total_removed = sum(int((e.get("cleanup") or {}).get("removed_bytes", 0) or 0) for e in requests)
    transformed = sum(1 for e in requests if e.get("transformed"))
    out.append("")
    out.append(f"transformed={transformed}/{len(requests)}  removed_bytes={total_removed}")
    out.append(f"Log: {path}")
    return "\n".join(out)

