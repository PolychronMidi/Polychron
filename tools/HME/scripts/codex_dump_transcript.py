#!/usr/bin/env python3
"""Translate a codex rollout JSONL into Claude-shape JSONL.

Usage: codex_dump_transcript.py <source_rollout> <output_path>

Codex rollouts carry events like {"type":"event_msg","payload":{...}} and
{"type":"response_item","payload":{...}}. The shared detectors expect
Claude's {"type":"assistant","message":{"role":..,"content":[...]}} shape.
This script does the structural translation so the same detector logic
applies cross-host.

Freshness: if <output_path> exists with mtime >= source mtime, skip rewrite.

Exit: 0 on success or skip, 1 on missing source.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def _wrap_user(blocks: list[dict]) -> dict:
    return {"type": "user", "message": {"role": "user", "content": blocks}}


def _wrap_assistant(blocks: list[dict]) -> dict:
    return {"type": "assistant", "message": {"role": "assistant", "content": blocks}}


def _adapt_event(obj: dict) -> list[dict]:
    """Translate one codex rollout event into 0+ Claude-shape events."""
    etype = obj.get("type")
    payload = obj.get("payload") or {}
    if not isinstance(payload, dict):
        return []
    if etype == "event_msg":
        ptype = payload.get("type")
        if ptype == "user_message":
            text = payload.get("message")
            return [_wrap_user([{"type": "text", "text": text}])] if text else []
        if ptype == "agent_message":
            text = payload.get("message")
            return [_wrap_assistant([{"type": "text", "text": text}])] if text else []
        if ptype == "agent_reasoning":
            text = payload.get("text")
            return [_wrap_assistant([{"type": "thinking", "thinking": text}])] if text else []
        return []
    if etype == "response_item":
        ptype = payload.get("type")
        if ptype == "function_call":
            call_id = str(payload.get("call_id") or "")
            name = str(payload.get("name") or "")
            args_raw = payload.get("arguments") or "{}"
            try:
                args = json.loads(args_raw) if isinstance(args_raw, str) else args_raw
            except json.JSONDecodeError:
                args = {"_raw": args_raw}
            return [_wrap_assistant([{"type": "tool_use", "id": call_id, "name": name, "input": args}])]
        if ptype == "function_call_output":
            call_id = str(payload.get("call_id") or "")
            output = payload.get("output", "")
            content = output if isinstance(output, str) else json.dumps(output)
            return [_wrap_user([{"type": "tool_result", "tool_use_id": call_id, "content": content}])]
        if ptype == "reasoning":
            summary = payload.get("summary") or []
            parts = [str(b.get("text") or "") for b in summary if isinstance(b, dict) and b.get("type") == "summary_text"]
            joined = "\n".join(p for p in parts if p)
            return [_wrap_assistant([{"type": "thinking", "thinking": joined}])] if joined else []
        if ptype == "message":
            role = payload.get("role") or "user"
            blocks: list[dict] = []
            for cb in payload.get("content") or []:
                if not isinstance(cb, dict):
                    continue
                if cb.get("type") in ("input_text", "output_text", "text"):
                    text = cb.get("text")
                    if text:
                        blocks.append({"type": "text", "text": text})
            if not blocks:
                return []
            if role == "assistant":
                return [_wrap_assistant(blocks)]
            return [_wrap_user(blocks)]
        return []
    return []


def _is_fresh(output_path: Path, source_mtime: float) -> bool:
    try:
        return output_path.stat().st_mtime >= source_mtime
    except OSError:
        return False


def translate(source: Path, output_path: Path) -> str:
    if not source.is_file():
        return ""
    try:
        source_mtime = source.stat().st_mtime
    except OSError:
        return ""
    if _is_fresh(output_path, source_mtime):
        return str(output_path)
    out_events: list[dict] = []
    with source.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            out_events.extend(_adapt_event(obj))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = output_path.with_suffix(output_path.suffix + f".{os.getpid()}.tmp")
    tmp.write_text("".join(json.dumps(ev) + "\n" for ev in out_events), encoding="utf-8")
    os.replace(tmp, output_path)
    return str(output_path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("output_path")
    args = ap.parse_args()
    result = translate(Path(args.source), Path(args.output_path))
    if result:
        print(result)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
