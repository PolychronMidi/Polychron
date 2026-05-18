#!/usr/bin/env python3
"""Detect repeated no-op resistance after corrective hook feedback."""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import event_content, is_assistant, is_user, iter_tool_results, iter_tool_uses, load_turn_events  # noqa: E402

DECLARED_VERDICTS = {"ok", "spiralling_petulance"}

_NOOP_BASH = re.compile(r"^\s*(?::|true|printf\s+['\"]?['\"]?|echo\s*['\"]?['\"]?)\s*$")
_HOOK_DIRECTIVE = re.compile(r"(<hook_prompt|stop hook feedback|antipattern:|scope-stacked antipattern|auto-completeness)", re.I)
_NOOP_TEXT = re.compile(r"^\s*(?:\.|ok(?:ay)?|done|fixed|nothing remains|all set)?\s*$", re.I)
_READ_FAILURE = re.compile(r"(enoent|no such file|verify-landed antipattern|blocked: verify-landed|read failed|not found)", re.I)


def _text(event: dict) -> str:
    parts: list[str] = []
    msg = event.get("message")
    content = msg.get("content") if isinstance(msg, dict) else event.get("content")
    if isinstance(content, str):
        parts.append(content)
    elif isinstance(content, list):
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
    if not parts:
        for block in event_content(event):
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
    return "\n".join(p for p in parts if p)


def _events(path: str) -> list[dict]:
    try:
        lines = Path(path).read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return []
    out: list[dict] = []
    import json
    for line in lines:
        if not line.strip():
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def _hook_noop_pairs(path: str) -> int:
    events = _events(path)[-24:]
    count = 0
    for idx, event in enumerate(events[:-1]):
        if not is_user(event) or not _HOOK_DIRECTIVE.search(_text(event)):
            continue
        nxt = events[idx + 1]
        if is_assistant(nxt) and _NOOP_TEXT.fullmatch(_text(nxt)) and not list(iter_tool_uses(nxt)):
            count += 1
    return count


def _current_turn_noop_tools(path: str) -> tuple[int, int]:
    noop_bash = 0
    read_ids: set[str] = set()
    failed_reads = 0
    for event in load_turn_events(path):
        for tu in iter_tool_uses(event):
            name = tu.get("name", "")
            if name == "Bash":
                cmd = str((tu.get("input") or {}).get("command", ""))
                if _NOOP_BASH.match(cmd):
                    noop_bash += 1
            if name == "Read" and tu.get("id"):
                read_ids.add(tu["id"])
        for tr in iter_tool_results(event):
            if tr.get("tool_use_id") in read_ids and _READ_FAILURE.search(tr.get("text", "")):
                failed_reads += 1
    return noop_bash, failed_reads


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    path = sys.argv[1]
    noop_bash, failed_reads = _current_turn_noop_tools(path)
    if _hook_noop_pairs(path) >= 2 or noop_bash >= 2 or failed_reads >= 2:
        print("spiralling_petulance")
    else:
        print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
