#!/usr/bin/env python3
"""Detect "design-space changes shipped without consulting senior" — the
exact anti-pattern that motivated this detector's existence.

The buddy paradigm rests on two-way collaboration. When a turn touches
files in the buddy/handoff design space (`buddy_handoff.py`,
`buddy_init.sh`, `buddy_spawn.py`, `buddy_dispatcher.py`, the open-questions
in `BUDDY_SYSTEM.md`, the `i/consult` and `i/handoff` wrappers) but
NEVER invokes `i/consult`, the operator's design intent gets bypassed
silently. This detector flips the default from "consulting is opt-in"
to "checkpointing is opt-out for this code area" — the behavioral
inversion proposed by 0e7fbf4d during a review consult.

First fire is informational (verdict surfaces in detector output but
the Stop chain doesn't block on it). If the pattern keeps recurring,
elevate the verdict to a hard block.

Quality proxy (per 0e7fbf4d's Section C analysis): the detector also
counts `# crystallized: ...` markers in tool_result content, which
land when a consult's response contained `[[KB-CRYSTALLIZE]]` blocks
that `cmd_consult` auto-extracted into the KB. A consult that produced
zero crystallized blocks AND happened on a design-space-edit turn
triggers `consult-thin` instead of `ok` — surfacing the
satisfy-the-detector-cheaply path that would otherwise become
Goodhart-bait.

Usage: senior_consult_debt.py <transcript_path>
Verdicts:
  ok               — either no design-space edit, or consult invoked
                     AND produced ≥1 crystallized block.
  consult-debt     — design-space edits with NO i/consult invocation.
  consult-thin     — design-space edits with consult invoked but ZERO
                     crystallized blocks (low-quality consult).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import (  # noqa: E402
    _parse_all, event_content, is_user, iter_tool_uses,
)


# Solo-rationale rescue: the deny prompt sanctions "explicitly note why
# solo was right" as an alternative to invoking i/consult. When the
# agent's text in the same turn explains why a checkpoint wasn't needed,
# fold to ok — the alternative path the deny advertises must actually
# exist. Patterns are sentence-shaped because the justification is
# rarely terse.
SOLO_RATIONALE_RES = (
    re.compile(r"\bsolo\s+(was|is)\s+(the\s+)?right\b", re.IGNORECASE),
    re.compile(r"\bdidn'?t\s+(need\s+to\s+)?consult\b[^.\n]{0,80}\bbecause\b", re.IGNORECASE),
    re.compile(r"\b(no|skipped?\s+the?)\s+consult\b[^.\n]{0,80}\bbecause\b", re.IGNORECASE),
    re.compile(r"\bskipping\s+(the\s+)?consult\b[^.\n]{0,60}\b(because|since|—)\b", re.IGNORECASE),
    re.compile(r"\b(mechanical|trivial|deterministic|narrow|bounded)\s+(rename|edit|change|fix)\b", re.IGNORECASE),
)


def _last_assistant_text(events: list) -> str:
    last = None
    for ev in events:
        if (ev.get("type") == "assistant"
                or (ev.get("role") == "assistant" and ev.get("content"))):
            last = ev
    if last is None:
        return ""
    parts = []
    for block in event_content(last):
        if isinstance(block, dict) and block.get("type") == "text":
            t = block.get("text", "")
            if isinstance(t, str):
                parts.append(t)
    return "\n".join(parts)


def _has_solo_rationale(text: str) -> bool:
    if not text:
        return False
    return any(pat.search(text) for pat in SOLO_RATIONALE_RES)


def _load_current_turn(transcript_path: str) -> list[dict]:
    """Return events from the most-recent REAL user prompt onward.

    Distinguishes real prompts (`message.content` is a string) from
    tool_result wrappers (`message.content` is a list with tool_result
    blocks). load_turn_events / load_full_turn_with_user use the LAST
    user-typed event regardless of shape, which incorrectly slices off
    tool_uses that happened before tool_result wrappers — wrong for a
    detector that needs to see the whole turn's tool activity.
    """
    events = _parse_all(transcript_path)
    last_real_user_idx = -1
    for i, ev in enumerate(events):
        if not is_user(ev):
            continue
        msg = ev.get("message")
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        # Real prompts have string content; tool_result wrappers have
        # a list of {type:tool_result, ...} blocks. The string check
        # is the distinguishing axis.
        if isinstance(content, str):
            last_real_user_idx = i
    if last_real_user_idx == -1:
        return events
    return events[last_real_user_idx:]

# Files whose edits ought to be checkpointed against the buddy. Matched
# as a substring at the end of the path so absolute and relative paths
# both hit. Add to this list as the buddy paradigm grows new components.
_DESIGN_SPACE = (
    "tools/HME/scripts/buddy_handoff.py",
    "tools/HME/scripts/buddy_dispatcher.py",
    "tools/HME/scripts/buddy_spawn.py",
    "tools/HME/hooks/helpers/buddy_init.sh",
    "tools/HME/hooks/lifecycle/stop/post_hooks.sh",
    "doc/BUDDY_SYSTEM.md",
    "i/consult",
    "i/handoff",
)


def _touches_design_space(path: str) -> bool:
    if not path:
        return False
    return any(path.endswith(target) or path.endswith("/" + target)
               or path == target for target in _DESIGN_SPACE)


def _is_consult_invocation(cmd: str) -> bool:
    """Match `i/consult ...` invocations whether direct or piped/chained.
    The wrapper accepts `sid=`, `primary=`, `buddy=`, `senior=` aliases —
    we don't care which form was used, only that the command ran."""
    if not cmd:
        return False
    return ("i/consult" in cmd
            and ("sid=" in cmd or "primary=" in cmd
                 or "buddy=" in cmd or "senior=" in cmd))


def _crystallized_markers_in_event(event: dict) -> int:
    """Scan all content blocks in an event for `# crystallized:` markers.
    cmd_consult emits these to stderr per successful KB-CRYSTALLIZE
    extraction; Claude Code captures stderr in the Bash tool_result
    content. Counting here (across blocks of any type) avoids false
    negatives from event-shape variation between fixture transcripts
    and real Claude Code transcripts."""
    count = 0
    for block in event_content(event):
        if not isinstance(block, dict):
            continue
        # tool_result content: either a string or a list of {type:text,
        # text:...}. Walk the structure conservatively.
        content = block.get("content") or block.get("text") or ""
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict):
                    text = item.get("text") or item.get("content") or ""
                    if isinstance(text, str):
                        count += text.count("# crystallized:")
                elif isinstance(item, str):
                    count += item.count("# crystallized:")
        elif isinstance(content, str):
            count += content.count("# crystallized:")
    return count


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    touched_design_space = False
    consulted = False
    crystallized_count = 0
    # _load_current_turn finds the last real user prompt (string
    # content) and includes everything from there forward, so
    # tool_result wrappers (list-content user-typed events) don't
    # slice off the consult tool_use that preceded them.
    for event in _load_current_turn(sys.argv[1]):
        for tu in iter_tool_uses(event):
            name = tu["name"]
            if name in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
                fp = tu["input"].get("file_path", "")
                if _touches_design_space(fp):
                    touched_design_space = True
            elif name == "Bash":
                cmd = tu["input"].get("command", "")
                if _is_consult_invocation(cmd):
                    consulted = True
        crystallized_count += _crystallized_markers_in_event(event)
    # Solo-rationale rescue: the deny prompt explicitly sanctions
    # "explicitly note why solo was right" as an alternative path. When
    # the agent's final text contains that justification, the consult-
    # debt is paid via reasoning, not via the i/consult invocation.
    final_text = _last_assistant_text(_load_current_turn(sys.argv[1]))
    solo_rationale = _has_solo_rationale(final_text)
    if touched_design_space and not consulted and solo_rationale:
        print("ok")
        return 0
    if touched_design_space and not consulted:
        print("consult-debt")
    elif touched_design_space and consulted and crystallized_count == 0:
        # Consult fired but produced no crystallized blocks. The agent
        # may have asked a low-content question, or the senior didn't
        # see anything worth crystallizing. Either way, the consult
        # doesn't carry quality weight — surface the gap so the
        # operator can see if it's chronic.
        print("consult-thin")
    else:
        print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
