#!/usr/bin/env python3
"""Detect psychopathic-stop patterns — deferring work instead of doing it.

Fires when ANY of these conditions hold in the current turn:

  Pattern A: "Schedule-and-run" — agent launches a long background job
  (training, pip install, nohup, reindex, HF download, etc.) and calls
  ScheduleWakeup in the same turn. The wakeup defers work instead of
  continuing with other productive tasks while the background job runs.

  Pattern B: "Admit-and-stop" — agent's final assistant message enumerates
  pending / remaining / can't-do-mid-turn work, but no tool calls follow
  that message. The agent told itself what to do next and then didn't do
  it. This is the most common antipattern variant — verbal procrastination
  disguised as a status report.

Usage: psycho_stop.py <transcript_path>
Output: "psycho" or "ok"
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import iter_tool_uses, load_turn_events  # noqa: E402

BG_KEYWORDS = (
    "train", "pip install", "pip3 install", "nohup", "accelerate", "axolotl",
    "unsloth", "merge_", "convert_hf_to_gguf", "finetune", "stress-test",
    # Generic long-running python scripts — `python3 /tmp/foo.py` or inline
    # `python3 <<EOF ... EOF` in a background command. Catches reindex
    # loops, download scripts, migration wrappers, and anything launched
    # from /tmp as a batch one-shot. The presence of `&` at end OR heredoc
    # marker also indicates the command was intended to run long.
    "python3 /tmp/", "python3 <<", "python <<",
    # Shim / daemon restarts deferred via nohup are not the same pattern
    # (those are quick) — they're caught elsewhere. But if a nohup or
    # disown appears in the command AND there's a wakeup, that's defer.
    "disown", "/reindex", "reindex",
    # HF / large model downloads
    "snapshot_download", "hf_hub_download", "huggingface_hub",
)


# Pattern B: "admit-and-stop" — final assistant text enumerates pending /
# remaining / cant-do-mid-turn work but no tool calls follow it. Matches
# phrases that announce future intent the agent refused to act on.
ADMIT_PHRASES = (
    "pending work",
    "still pending",
    "remaining work",
    "still need to",
    "will activate on next",
    "will pick up on next",
    "activates on next session",
    "activates on next restart",
    "can't do from within",
    "cant do from within",
    "can't do mid-turn",
    "cant do mid-turn",
    "session-level",
    "session level",
    "follow-up task",
    "followup task",
    "will happen on next",
    "won't do",
    "wont do",
    "deferring",
    "deferred to",
    "next session",
    "on next session",
)


# Pattern C: "survey-and-ask" — agent executes a hardening / audit / refactor
# directive, identifies violations, then asks the user for permission to
# fix them instead of fixing. The user's directive already granted authority;
# stopping to ask is a covert defer. Triggers when the final assistant text
# contains any of these permission-solicitation phrases AND no tool calls
# follow. Distinct from ADMIT_PHRASES: those announce the agent won't do the
# work; these pretend the agent is helpfully checking in.
PERMISSION_ASK_PHRASES = (
    "want me to",
    "would you like me to",
    "do you want me to",
    "should i fix",
    "should i proceed",
    "should i run",
    "should i start",
    "shall i",
    "before any edits",
    "before i make any edits",
    "before i start editing",
    "before i begin",
    "before i touch",
    "survey more files before",
    "survey first",
    "surveyed, not modified",
    "surveyed but not modified",
    "surveyed, not fixed",
    "didn't modify",
    "did not modify",
    "i didn't touch",
    "i didn't edit",
    "haven't modified",
    "not yet modified",
    "not yet fixed",
    "not yet applied",
    "flagging for later",
    "flag for later",
    "out of scope for this session",
    "not in scope for this session",
    "want me to continue",
    "want me to keep going",
    "confirm before",
    "confirm first",
)


def _is_assistant_event(event: dict) -> bool:
    if event.get("role") != "assistant":
        return False
    return bool(event.get("content"))


def _last_assistant_text(events: list) -> str:
    """Concatenate all text blocks from the LAST assistant event in the turn."""
    last_asst = None
    for ev in events:
        if _is_assistant_event(ev):
            last_asst = ev
    if last_asst is None:
        return ""
    parts = []
    for block in last_asst.get("content", []) or []:
        if isinstance(block, dict) and block.get("type") == "text":
            t = block.get("text", "")
            if isinstance(t, str):
                parts.append(t)
    return "\n".join(parts)


def _has_tool_call_after_last_text(events: list) -> bool:
    """True if any tool_use block appears after the LAST text block in the
    turn. Used to distinguish "said it and did it" from "said it and
    stopped". Two cases count as 'after':

      1. A tool_use content block appears after a text content block in
         the same assistant event's content list (interleaved pattern).
      2. A tool_use content block appears in an assistant event that
         comes after the event containing the last text block.
    """
    # Find (event_idx, block_idx) of the last text block anywhere in the turn.
    last_text_event_idx = -1
    last_text_block_idx = -1
    for i, ev in enumerate(events):
        if not _is_assistant_event(ev):
            continue
        content = ev.get("content", []) or []
        for bi, block in enumerate(content):
            if isinstance(block, dict) and block.get("type") == "text":
                last_text_event_idx = i
                last_text_block_idx = bi
    if last_text_event_idx < 0:
        return False  # no text at all — nothing to guard against

    # Case 1: interleaved in same event — check blocks after last_text_block_idx
    last_ev = events[last_text_event_idx]
    content = last_ev.get("content", []) or []
    for bi in range(last_text_block_idx + 1, len(content)):
        block = content[bi]
        if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name"):
            return True

    # Case 2: subsequent events contain a tool_use
    for ev in events[last_text_event_idx + 1:]:
        for tu in iter_tool_uses(ev):
            if tu.get("name"):
                return True
    return False


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_turn_events(sys.argv[1])

    # Pattern A: schedule-and-run
    saw_bg = False
    saw_wakeup = False
    for event in events:
        for tu in iter_tool_uses(event):
            if tu["name"] == "ScheduleWakeup":
                saw_wakeup = True
            if tu["name"] == "Bash" and tu["input"].get("run_in_background"):
                cmd = tu["input"].get("command", "")
                if any(kw in cmd for kw in BG_KEYWORDS):
                    saw_bg = True
            # Heredoc-in-foreground-then-disown pattern:
            # `python3 <<'EOF' ... EOF &` with disown. Not flagged by the
            # harness as run_in_background but IS a background job.
            if tu["name"] == "Bash" and not tu["input"].get("run_in_background"):
                cmd = tu["input"].get("command", "")
                if " &" in cmd and "disown" in cmd:
                    if any(kw in cmd for kw in BG_KEYWORDS):
                        saw_bg = True
    if saw_bg and saw_wakeup:
        print("psycho")
        return 0

    # Pattern B: admit-and-stop
    final_text = _last_assistant_text(events).lower()
    if final_text:
        for phrase in ADMIT_PHRASES:
            if phrase in final_text:
                if not _has_tool_call_after_last_text(events):
                    print("psycho")
                    return 0

        # Pattern C: survey-and-ask — soliciting permission after surveying
        # rather than executing. Same "no tool calls after final text" guard.
        for phrase in PERMISSION_ASK_PHRASES:
            if phrase in final_text:
                if not _has_tool_call_after_last_text(events):
                    print("psycho")
                    return 0

    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
