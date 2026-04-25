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
from _transcript import (  # noqa: E402
    iter_tool_uses, load_turn_events, load_full_turn_with_user,
    is_assistant, is_user, event_content,
)

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
    return is_assistant(event)


# Ideation markers — when the user's last message asks for ideas /
# opinions / comparisons / explanations rather than giving a directive,
# Pattern C ("survey-and-ask") becomes a legitimate collaborative
# response, not deferral. Without this gate, psycho_stop fires on every
# "what would you suggest" → "here are options, which?" turn — exactly
# the wrong incentive for a brainstorming exchange.
_IDEATION_MARKERS = (
    # Question stems that signal "tell me / show me, don't do"
    "what would", "what could", "what should we", "what do you think",
    "what are some", "what's worth", "what does this", "what does it",
    "what if ", "how else", "how could we", "how would we",
    "any ideas", "any suggestions", "any thoughts",
    "thoughts?", "ideas?", "suggestions?", "opinions?",
    # Comparison / explanation prompts
    "describe ", "explain ", "compare ", "how does ", "why does ",
    # Capability / design discussions
    "worth integrating", "worth adopting", "could integrate",
    "drive you to", "frenzied ecstasy",
    # Reaction-and-pivot patterns: "nah, what if..." / "i don't like..."
    # signal the user is steering a discussion, not directing an action.
    "i don't like", "i dont like", "i don't think", "i dont think",
    "rather than that",
)

# Directive markers — when these appear (even alongside a question),
# the user IS giving an action directive and survey-and-ask is defer.
# Removed words (too broad in normal prose): "run " (false-positives on
# "those run on", "we run a pipeline"), "apply " (false-positives on
# "apply this rule mentally"), "remove " (false-positives on "remove
# the noise from the prose"), "create " (false-positives on "what
# would create the bug?"). Kept words are unambiguous imperative verbs.
_DIRECTIVE_MARKERS = (
    "fix ", "fix the", "fix this", "fix that",
    " do all", "do all ", "do it", "do that",
    "implement ", "build ", "ship ", "wire it", "wire up",
    "make sure ", "ensure ", "verify that ",
    "audit ", "refactor ", "rename ",
    "execute ", "commit ",
)


def _last_user_text(events: list) -> str:
    """Concatenate all text blocks from the LAST user event in the turn."""
    last_user = None
    for ev in events:
        if is_user(ev):
            last_user = ev
    if last_user is None:
        return ""
    parts = []
    for block in event_content(last_user):
        if isinstance(block, dict) and block.get("type") == "text":
            t = block.get("text", "")
            if isinstance(t, str):
                parts.append(t)
        elif isinstance(block, str):
            parts.append(block)
    return "\n".join(parts)


def _is_ideation_prompt(user_text: str) -> bool:
    """User's last message reads as a request for ideas / opinions /
    explanations rather than an action directive. When this returns True,
    Pattern C ("survey-and-ask") should be suppressed: the agent
    legitimately surveys options and asks which to prioritize.

    Logic: directive markers DOMINATE — if the user said "fix it" they
    want action, even if they also asked "what's the best approach?".
    Otherwise, ideation markers gate the suppression. Hook-injected
    system reminders are stripped before classification (they often
    contain directive language unrelated to the user's actual request).
    """
    if not user_text:
        return False
    # Strip system-reminder envelopes — those carry hook language, not
    # user intent. The actual user prompt sits between/around them.
    import re as _re
    cleaned = _re.sub(
        r"<system-reminder>.*?</system-reminder>",
        " ",
        user_text,
        flags=_re.DOTALL,
    )
    low = cleaned.lower()
    # Directive markers win — agent must act regardless of any "what's best"
    # framing the user appended.
    for marker in _DIRECTIVE_MARKERS:
        if marker in low:
            return False
    # No directive — does the prompt read as ideation?
    for marker in _IDEATION_MARKERS:
        if marker in low:
            return True
    return False


def _last_assistant_text(events: list) -> str:
    """Concatenate all text blocks from the LAST assistant event in the turn."""
    last_asst = None
    for ev in events:
        if _is_assistant_event(ev):
            last_asst = ev
    if last_asst is None:
        return ""
    parts = []
    for block in event_content(last_asst):
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
        content = event_content(ev)
        for bi, block in enumerate(content):
            if isinstance(block, dict) and block.get("type") == "text":
                last_text_event_idx = i
                last_text_block_idx = bi
    if last_text_event_idx < 0:
        return False  # no text at all — nothing to guard against

    # Case 1: interleaved in same event — check blocks after last_text_block_idx
    last_ev = events[last_text_event_idx]
    content = event_content(last_ev)
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


def _emit_stats(pattern: str, detail: str) -> None:
    """Append a detector-run line to metrics/detector-stats.jsonl so dead
    phrase lists + dead patterns become quantitatively visible over time.
    Silent on write failures — this is observability, not correctness."""
    try:
        import json
        import time
        import os
        root = os.environ.get("PROJECT_ROOT")
        if not root:
            # Walk up from this script.
            from pathlib import Path
            here = Path(__file__).resolve()
            for parent in [here.parent, *here.parents]:
                if (parent / "CLAUDE.md").exists() and (parent / ".env").exists():
                    root = str(parent)
                    break
        if not root:
            return
        out_path = os.path.join(root, "output", "metrics", "detector-stats.jsonl")
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        # Append + trim under fcntl.flock so concurrent detector runs
        # don't lose lines. Previously two concurrent invocations could
        # both decide len(lines) > 5000 and both truncate-write, dropping
        # the second's appended line. flock serializes.
        import fcntl as _fcntl
        with open(out_path, "a", encoding="utf-8") as f:
            _fcntl.flock(f.fileno(), _fcntl.LOCK_EX)
            try:
                f.write(json.dumps({
                    "ts": time.time(),
                    "detector": "psycho_stop",
                    "verdict": pattern,
                    "detail": detail,
                }) + "\n")
                f.flush()
                # Trim to last 5000 lines while still holding the lock.
                try:
                    with open(out_path, "r", encoding="utf-8") as rf:
                        lines = rf.readlines()
                    if len(lines) > 5000:
                        with open(out_path, "w", encoding="utf-8") as wf:
                            wf.writelines(lines[-5000:])
                except OSError as _trim_err:
                    import sys as _sys
                    print(f"[psycho_stop] stats trim failed: "
                          f"{type(_trim_err).__name__}: {_trim_err}", file=_sys.stderr)
            finally:
                _fcntl.flock(f.fileno(), _fcntl.LOCK_UN)
    except (OSError, TypeError, ValueError) as _emit_err:
        import sys as _sys
        print(f"[psycho_stop] stats emit failed: "
              f"{type(_emit_err).__name__}: {_emit_err}", file=_sys.stderr)


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    # Read the transcript once into both views so later Pattern-C ideation
    # gate and earlier Pattern-B tool-call check see the SAME snapshot.
    # Previously `load_turn_events` and `load_full_turn_with_user` were
    # called separately — if the transcript file was appended between
    # reads (active session), the views diverged and a directive turn
    # could ideation-pass on a stale read while the tool-call guard
    # inspected a newer view. Caught by thread-routed self-review.
    events_with_user = load_full_turn_with_user(sys.argv[1])
    # Derive the post-last-user slice from the same snapshot.
    _user_idx = -1
    for i, _ev in enumerate(events_with_user):
        if is_user(_ev):
            _user_idx = i
    events = events_with_user[_user_idx + 1:] if _user_idx >= 0 else events_with_user

    # Pattern A: schedule-and-run
    saw_bg = False
    saw_wakeup = False
    matched_bg_kw = None
    for event in events:
        for tu in iter_tool_uses(event):
            if tu["name"] == "ScheduleWakeup":
                saw_wakeup = True
            if tu["name"] == "Bash" and tu["input"].get("run_in_background"):
                cmd = tu["input"].get("command", "")
                for kw in BG_KEYWORDS:
                    if kw in cmd:
                        saw_bg = True
                        matched_bg_kw = kw
                        break
            # Heredoc-in-foreground-then-disown pattern:
            # `python3 <<'EOF' ... EOF &` with disown. Not flagged by the
            # harness as run_in_background but IS a background job.
            if tu["name"] == "Bash" and not tu["input"].get("run_in_background"):
                cmd = tu["input"].get("command", "")
                if " &" in cmd and "disown" in cmd:
                    for kw in BG_KEYWORDS:
                        if kw in cmd:
                            saw_bg = True
                            matched_bg_kw = kw
                            break
    if saw_bg and saw_wakeup:
        _emit_stats("psycho", f"pattern_A: bg+wakeup (kw={matched_bg_kw!r})")
        print("psycho")
        return 0

    # Pattern B/C scan against the agent's OWN voice — strip quoted/code
    # content before phrase-matching. Without this, a response that
    # described a test fixture or quoted user input (e.g. `"Want me to
    # apply the fix?"` inside a list of test cases) would be flagged as
    # if the agent itself were asking for permission. The strips below
    # remove single-quoted, double-quoted, and backtick-quoted spans
    # plus fenced code blocks, leaving only the agent's bare prose.
    import re as _re_psy
    raw_final = _last_assistant_text(events)
    stripped = _re_psy.sub(r"```.*?```", " ", raw_final, flags=_re_psy.DOTALL)
    stripped = _re_psy.sub(r"`[^`\n]*`", " ", stripped)
    stripped = _re_psy.sub(r'"[^"\n]*"', " ", stripped)
    stripped = _re_psy.sub(r"'[^'\n]*'", " ", stripped)
    final_text = stripped.lower()
    # Compute ideation gate ONCE — used by both Pattern B and Pattern C.
    # When the user's prompt asks for ideas / opinions / comparisons /
    # discussion (no directive verbs), the agent legitimately uses
    # ADMIT-phrase-like language to describe options ("their approach
    # writes to next session, yours is better"). Without this gate,
    # comparison talk gets flagged as deferral. Directive markers in the
    # user prompt still override — "fix this" + admit-phrase still psycho.
    # Use events_with_user captured at the top of main — re-reading the
    # transcript here would create a race where the slice and this view
    # could diverge if the file was appended between reads.
    user_text = _last_user_text(events_with_user)
    user_is_ideating = _is_ideation_prompt(user_text)
    if final_text:
        if not user_is_ideating:
            for phrase in ADMIT_PHRASES:
                if phrase in final_text:
                    if not _has_tool_call_after_last_text(events):
                        _emit_stats("psycho", f"pattern_B: admit_phrase={phrase!r}")
                        print("psycho")
                        return 0

        # Pattern C: survey-and-ask — same ideation gate as Pattern B above.
        # When the user's prompt is ideation/discussion, survey-and-ask is
        # collaborative (here are 3 options, which fits?), not defer.
        if user_is_ideating:
            _emit_stats("ok", "ideation_prompt_skipped_pattern_C")
        else:
            for phrase in PERMISSION_ASK_PHRASES:
                if phrase in final_text:
                    if not _has_tool_call_after_last_text(events):
                        _emit_stats("psycho", f"pattern_C: ask_phrase={phrase!r}")
                        print("psycho")
                        return 0

    _emit_stats("ok", "")
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
