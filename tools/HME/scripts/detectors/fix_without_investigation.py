#!/usr/bin/env python3
"""Detect "edit-as-fix without prior investigation" antipattern.

Pattern absorbed from polychron-references/superpowers-main:
systematic-debugging's Phase Gate -- "NO FIXES WITHOUT ROOT CAUSE
INVESTIGATION FIRST. If you haven't completed Phase 1, you cannot
propose fixes."

Trigger:
  (a) The triggering user message is BUG-SHAPED -- contains words like
      "bug", "broken", "fails", "crash", "error", "doesn't work",
      "not working", "regression", "wrong", "off", "stuck", "hangs"
      ALONG WITH a request-to-fix shape (or no implementation request,
      just the report).
  (b) The agent's response contains Edit/Write/MultiEdit/NotebookEdit
      tool_uses.
  (c) NO investigation tool_use (Read/Grep/Glob/Bash with inspection
      command) appears BEFORE the first Edit in the same turn.

Conservative: this fires only when the user's prompt explicitly reports
broken behavior. Feature-add / refactor prompts are exempt -- jumping
to Edit without prior investigation is reasonable for those.

Verdict: "fix_without_investigation" or "ok".
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import (  # noqa: E402
    is_assistant, is_user, event_content, load_full_turn_with_user,
    iter_tool_uses,
)


# Bug-report shape in user prompt. Matches a wide-ish set of "something
# is broken" phrasings. Combined with the fix-request OR standalone-report
# disambiguation below.
_BUG_REPORT_RE = re.compile(
    r"\b(bug|broken|fails?|failing|crash(?:es|ed|ing)?|error(?:s)?|"
    r"doesn'?t\s+work|not\s+working|regression|wrong|off|stuck|hangs?|"
    r"misbehav\w+|incorrect|unexpected|why\s+(?:isn'?t|wasn'?t|did|does)\b"
    r"|not\s+(?:firing|caught|catching|stripped|stripping)\b|"
    r"why\s+wasn'?t|why\s+didn'?t)\b",
    re.IGNORECASE,
)

# Investigation-shape Bash commands. If the agent runs ANY of these
# BEFORE the first Edit, we credit them with investigation.
# Mirrors claim_without_evidence's evidence list, scoped to inspection
# (no execution-of-build/test which would also count there).
_INVESTIGATION_BASH_TOKENS = (
    "grep", "find", "ls", "stat", "cat", "head", "tail", "wc", "diff",
    "git log", "git show", "git diff", "git blame", "git status",
    "ps", "lsof", "netstat", "curl", "i/why", "i/status",
    "i/learn", "audit-", "verify-",
    "/health",
)

# Tool names that count as investigation regardless of args.
_INVESTIGATION_TOOLS = {"Read", "Grep", "Glob", "TaskOutput", "WebFetch"}

# Tool names that count as fixes (the things this gate guards against
# when fired without prior investigation).
_FIX_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


def _last_user_text(events: list) -> str:
    last_u = None
    for ev in events:
        if is_user(ev):
            last_u = ev
    if last_u is None:
        return ""
    parts = []
    for block in event_content(last_u):
        if isinstance(block, dict) and block.get("type") == "text":
            t = block.get("text", "")
            if isinstance(t, str):
                parts.append(t)
        elif isinstance(block, str):
            parts.append(block)
    msg = last_u.get("message")
    if isinstance(msg, dict):
        c = msg.get("content")
        if isinstance(c, str):
            parts.append(c)
        elif isinstance(c, list):
            for block in c:
                if isinstance(block, dict) and block.get("type") == "text":
                    t = block.get("text", "")
                    if isinstance(t, str):
                        parts.append(t)
    return "\n".join(parts)


def _last_assistant_event(events: list) -> dict | None:
    last = None
    for ev in events:
        if is_assistant(ev):
            last = ev
    return last


def _is_investigation_tool_use(tu: dict) -> bool:
    name = tu.get("name", "")
    if name in _INVESTIGATION_TOOLS:
        return True
    if name == "Bash":
        cmd = ""
        inp = tu.get("input", {}) or {}
        if isinstance(inp, dict):
            cmd = str(inp.get("command", ""))
        elif isinstance(inp, str):
            cmd = inp
        cmd_l = cmd.lower()
        for tok in _INVESTIGATION_BASH_TOKENS:
            if tok in cmd_l:
                return True
    return False


def _is_fix_tool_use(tu: dict) -> bool:
    return tu.get("name", "") in _FIX_TOOLS


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_full_turn_with_user(sys.argv[1])
    if not events:
        print("ok")
        return 0

    user_text = _last_user_text(events)
    if not user_text or not _BUG_REPORT_RE.search(user_text):
        print("ok")
        return 0

    last_assistant = _last_assistant_event(events)
    if not last_assistant:
        print("ok")
        return 0

    # Walk the assistant's tool_uses in order. Find the first fix-tool
    # use; if no investigation-shape tool_use appeared BEFORE it, fire.
    investigated = False
    for tu in iter_tool_uses(last_assistant):
        if _is_fix_tool_use(tu):
            if not investigated:
                print("fix_without_investigation")
                return 0
            # Otherwise: investigation happened first, we're clean.
            print("ok")
            return 0
        if _is_investigation_tool_use(tu):
            investigated = True

    # No fix tool_use at all -- fine, the agent may have just answered.
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
