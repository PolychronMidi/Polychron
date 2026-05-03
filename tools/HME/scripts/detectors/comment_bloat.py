#!/usr/bin/env python3
"""Detect comment-bloat violations against CLAUDE.md.

Rule (CLAUDE.md): "Inline comments single-line and terse. Elaboration
goes in doc/."

Detector: scan the current turn's assistant Edit/Write tool calls; for
each, count contiguous runs of inline-comment lines in the new content.
Threshold: any run of >= 4 consecutive comment lines is a violation.

Verdicts:
  ok            no violations OR no relevant tool calls this turn
  comment_bloat at least one Edit/Write contains a 4+ line inline-comment run
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import _parse_all, event_content, is_assistant  # noqa: E402

THRESHOLD = 4

# Comment-prefix patterns by file extension (best-effort; defaults to '#').
_COMMENT_PREFIXES = {
    ".py": ("#",),
    ".sh": ("#",),
    ".bash": ("#",),
    ".js": ("//",),
    ".ts": ("//",),
    ".jsx": ("//",),
    ".tsx": ("//",),
    ".mjs": ("//",),
    ".cjs": ("//",),
    ".rs": ("//",),
    ".go": ("//",),
    ".c": ("//",),
    ".cc": ("//",),
    ".cpp": ("//",),
    ".h": ("//",),
    ".hpp": ("//",),
    ".java": ("//",),
    ".kt": ("//",),
    ".swift": ("//",),
    ".sql": ("--",),
    ".lua": ("--",),
    ".rb": ("#",),
    ".yaml": ("#",),
    ".yml": ("#",),
    ".toml": ("#",),
}


def _prefixes_for(path: str) -> tuple[str, ...]:
    p = path.lower()
    for ext, prefixes in _COMMENT_PREFIXES.items():
        if p.endswith(ext):
            return prefixes
    return ()


def _max_run(text: str, prefixes: tuple[str, ...]) -> int:
    if not prefixes or not text:
        return 0
    longest = 0
    current = 0
    for raw in text.splitlines():
        stripped = raw.lstrip()
        if any(stripped.startswith(p) for p in prefixes):
            current += 1
            if current > longest:
                longest = current
        else:
            current = 0
    return longest


def _last_user_idx(events: list[dict]) -> int:
    last = -1
    for i, ev in enumerate(events):
        if ev.get("type") != "user":
            continue
        msg = ev.get("message")
        if isinstance(msg, dict) and isinstance(msg.get("content"), str):
            last = i
    return last


def _scan_tool_uses(event: dict) -> list[tuple[str, str]]:
    """Yield (file_path, new_text) tuples for Edit/Write calls in this event."""
    out = []
    if not is_assistant(event):
        return out
    for block in event_content(event):
        if not isinstance(block, dict) or block.get("type") != "tool_use":
            continue
        name = block.get("name")
        inp = block.get("input") or {}
        if name == "Edit":
            fp = inp.get("file_path") or ""
            ns = inp.get("new_string") or ""
            if isinstance(fp, str) and isinstance(ns, str):
                out.append((fp, ns))
        elif name == "Write":
            fp = inp.get("file_path") or ""
            content = inp.get("content") or ""
            if isinstance(fp, str) and isinstance(content, str):
                out.append((fp, content))
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = _parse_all(sys.argv[1])
    start = _last_user_idx(events)
    if start < 0:
        print("ok")
        return 0
    for ev in events[start:]:
        for fp, text in _scan_tool_uses(ev):
            prefixes = _prefixes_for(fp)
            if not prefixes:
                continue
            if _max_run(text, prefixes) >= THRESHOLD:
                print("comment_bloat")
                return 0
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
