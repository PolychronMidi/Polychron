#!/usr/bin/env python3
"""Block stale/noisy handling of Claude Code task notifications.

The latest user event may be a host control-plane notification, not a natural
language prompt. When it says a background task completed/failed, final text must
reflect those facts instead of claiming the notification was stripped/empty or
that the task is still running.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import (  # noqa: E402
    event_content,
    is_real_user_prompt,
    is_user,
    last_assistant_text_in,
    load_full_turn_with_user,
)

DECLARED_VERDICTS = {"ok", "task_notification_mishandled"}

TASK_RE = re.compile(r"<task-notification>[\s\S]*?</task-notification>", re.IGNORECASE)
FIELD_RE = re.compile(r"<(?P<name>task-id|status|summary)>\s*(?P<value>[\s\S]*?)\s*</(?P=name)>", re.IGNORECASE)
EXIT_RE = re.compile(r"exit code\s+(-?\d+)", re.IGNORECASE)

NOISE_RE = re.compile(
    r"\b(strip(?:ped)?\s+(?:notice|message|msg|content|context)|"
    r"no\s+(?:new\s+req(?:uest)?\s+text|actionable\s+content)|"
    r"empty\s*/\s*stripped|stripped\s+by\s+hme|"
    r"wait(?:ing|n)?\s+(?:for|4)\s+(?:completion|compltn)|"
    r"await(?:ing)?\s+(?:completion|compltn)|"
    r"still\s+(?:running|runnn?g|wait(?:ing|n)))\b",
    re.IGNORECASE,
)
WAIT_RE = re.compile(r"\b(still|currently)\s+(?:running|runnn?g|wait(?:ing|n))\b|\bawait(?:ing)?\s+(?:completion|compltn)\b", re.IGNORECASE)
PASS_RE = re.compile(r"\b(pass(?:ed|es)?|green|completed|done|exit\s+code\s+0|exit\s+0)\b", re.IGNORECASE)
FAIL_RE = re.compile(r"\b(fail(?:ed|ure)?|exit\s+code\s+(?!0\b)-?\d+|exit\s+(?!0\b)-?\d+|diagnos|fix|root\s+cause)\b", re.IGNORECASE)


def _event_text(event: dict) -> str:
    parts: list[str] = []
    msg = event.get("message") if isinstance(event, dict) else None
    if isinstance(msg, dict) and isinstance(msg.get("content"), str):
        parts.append(msg["content"])
    maybe = event.get("content") if isinstance(event, dict) else None
    if isinstance(maybe, str):
        parts.append(maybe)
    for block in event_content(event):
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
            parts.append(block["text"])
    return "\n".join(parts)


def _latest_real_user_text(events: list[dict]) -> str:
    last = ""
    for ev in events:
        if is_user(ev) and is_real_user_prompt(ev):
            last = _event_text(ev)
    return last


def _parse_notification(text: str) -> dict[str, str] | None:
    m = TASK_RE.search(text or "")
    if not m:
        return None
    body = m.group(0)
    fields: dict[str, str] = {}
    for fm in FIELD_RE.finditer(body):
        fields[fm.group("name").lower()] = re.sub(r"\s+", " ", fm.group("value")).strip()
    if not fields.get("status"):
        return None
    summary = fields.get("summary", "")
    em = EXIT_RE.search(summary)
    if em:
        fields["exit_code"] = em.group(1)
    return fields


def _assistant_handled_notification(note: dict[str, str], assistant: str) -> bool:
    text = assistant or ""
    if not text.strip():
        return False
    if NOISE_RE.search(text):
        return False
    status = note.get("status", "").lower()
    task_id = note.get("task-id", "")
    exit_code = note.get("exit_code", "")
    mentions_task = bool(task_id and task_id in text)
    mentions_exit = bool(exit_code and re.search(rf"\b(?:exit\s+code\s+{re.escape(exit_code)}|exit\s+{re.escape(exit_code)})\b", text, re.IGNORECASE))

    if status == "completed":
        if WAIT_RE.search(text):
            return False
        return mentions_task or mentions_exit or bool(PASS_RE.search(text))
    if status == "failed":
        return mentions_task or mentions_exit or bool(FAIL_RE.search(text))
    # Unknown status: at minimum do not emit empty/stripped/waiting boilerplate,
    # and mention the control-plane status or task id.
    return mentions_task or status in text.lower()


def verdict_for_events(events: list[dict]) -> str:
    user_text = _latest_real_user_text(events)
    note = _parse_notification(user_text)
    if not note:
        return "ok"
    assistant = last_assistant_text_in(events)
    return "ok" if _assistant_handled_notification(note, assistant) else "task_notification_mishandled"


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    try:
        events = load_full_turn_with_user(sys.argv[1])
        print(verdict_for_events(events))
    except Exception:
        # Detectors fail open; broken detector code must not brick Stop.
        print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
