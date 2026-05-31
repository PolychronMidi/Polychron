#!/usr/bin/env python3
"""Detect psychopathic-stop patterns -- deferring work instead of doing it.

Fires when ANY of these conditions hold in the current turn:

  Pattern A: "Schedule-and-run" -- agent launches a long background job
  (training, pip install, nohup, reindex, HF download, etc.) and calls
  ScheduleWakeup in the same turn. The wakeup defers work instead of
  continuing with other productive tasks while the background job runs.

  Pattern B: "Admit-and-stop" -- agent's final assistant message enumerates
  pending / remaining / can't-do-mid-turn work, but no tool calls follow
  that message. The agent told itself what to do next and then didn't do
  it. This is the most common antipattern variant -- verbal procrastination
  disguised as a status report.

Usage: psycho_stop.py <transcript_path>
Output: "psycho" or "ok"
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _base import detector, load_turn, transcript_arg  # noqa: E402
from _transcript import (  # noqa: E402
    iter_tool_uses, load_turn_events, load_full_turn_with_user,
    is_assistant, is_user, event_content,
)

DETECTOR = detector("psycho_stop")
_emit_stats = DETECTOR.emit

BG_KEYWORDS = (
    "train", "pip install", "pip3 install", "nohup", "accelerate", "axolotl",
    "unsloth", "merge_", "convert_hf_to_gguf", "finetune", "stress-test",
    # Generic long-running python in the OS tempdir, or heredoc.
    "python3 " + tempfile.gettempdir().rstrip(os.sep) + os.sep,  # "python3 <<", "python <<",
    # Daemon restarts via nohup/disown when paired with a wakeup -> defer.
    "disown", "/reindex", "reindex",
    # HF / large model downloads
    "snapshot_download", "hf_hub_download", "huggingface_hub",
)


# Pattern B "admit-and-stop": final text enumerates pending/remaining work
# without a follow-up tool call. ADMIT_PHRASES sourced from _phrase_lists
# (shared with exhaust_check/early_stop to prevent drift).
from _phrase_lists import (  # noqa: E402
    DEFERRAL_FUTURE_TENSE,
    DEFERRAL_FLAG_FOR_LATER,
    DEFERRAL_ACK_NO_FIX,
    DEFERRAL_CANT_DO,
    FORWARD_ACTION_PUNT_PHRASES,
    SURVEY_PERMISSION_ASK,
)
ADMIT_PHRASES = (
    DEFERRAL_FUTURE_TENSE
    + DEFERRAL_FLAG_FOR_LATER
    + DEFERRAL_ACK_NO_FIX
    + DEFERRAL_CANT_DO
    + FORWARD_ACTION_PUNT_PHRASES
)


# Pattern C "survey-and-ask": agent identifies violations then asks permission
# instead of fixing (covert defer). Phrases: SURVEY_PERMISSION_ASK union with
# the survey-shape subsets of DEFERRAL_ACK_NO_FIX + DEFERRAL_FLAG_FOR_LATER.
PERMISSION_ASK_PHRASES = (
    SURVEY_PERMISSION_ASK
    + DEFERRAL_ACK_NO_FIX
    + DEFERRAL_FLAG_FOR_LATER
)


def _is_assistant_event(event: dict) -> bool:
    return is_assistant(event)


# Ideation markers: when user asks for ideas/opinions/explanations,
# Pattern C survey-and-ask is legitimate brainstorming, not deferral.
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

# Directive markers: action verbs that override ideation framing.
# Skipped (too broad): run/apply/remove/create -- false-positive prone.
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

    Logic: directive markers DOMINATE -- if the user said "fix it" they
    want action, even if they also asked "what's the best approach?".
    Otherwise, ideation markers gate the suppression. Hook-injected
    system reminders are stripped before classification (they often
    contain directive language unrelated to the user's actual request).
    """
    if not user_text:
        return False
    # Strip system-reminder envelopes -- those carry hook language, not user intent.
    import re as _re
    cleaned = _re.sub(
        r"<system-reminder>.*?</system-reminder>", " ", user_text, flags=_re.DOTALL,
    )
    low = cleaned.lower()
    # Directive markers win.
    for marker in _DIRECTIVE_MARKERS:
        if marker in low:
            return False
    # No directive -- ideation only if the marker is present.
    for marker in _IDEATION_MARKERS:
        if marker in low:
            return True
    return False


# Completion-claim markers -- when the AGENT'S prior turn made one of these
# claims, the next user prompt is FOLLOW-UP context, not pure ideation.
# Suppression should NOT apply: enumerative answers are likely deferring
# the just-claimed completion's residual work.
_COMPLETION_CLAIM_MARKERS = (
    "all 4 shipped", "all four shipped", "all done", "all complete",
    "all four complete", "shipped all", "completed all",
    "all four:", "all 4:", "all of these complete", "all items complete",
    "everything is done", "everything's done", "all set",
)


def _prior_assistant_claimed_completion(events: list) -> bool:
    """True if the assistant turn BEFORE the most recent user prompt
    contained a completion-claim marker. (Not the current turn -- the one
    BEFORE the user's reaction.) Used to override the ideation-prompt
    suppression: when prior turn claimed 'all done' and the current
    response enumerates remaining work, the ideation context is misleading."""
    last_user_idx = -1
    for i, ev in enumerate(events):
        if ev.get("type") == "user":
            msg = ev.get("message")
            if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                last_user_idx = i
    if last_user_idx <= 0:
        return False
    # Walk backward from the user prompt to find the assistant text BEFORE it.
    prior = ""
    for ev in reversed(events[:last_user_idx]):
        if _is_assistant_event(ev):
            for b in event_content(ev):
                if isinstance(b, dict) and b.get("type") == "text":
                    t = b.get("text", "")
                    if isinstance(t, str) and t.strip():
                        prior = t
                        break
            if prior:
                break
    low = prior.lower()
    return any(m in low for m in _COMPLETION_CLAIM_MARKERS)


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
        return False  # no text at all -- nothing to guard against

    # Case 1: interleaved in same event -- check blocks after last_text_block_idx
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



def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    # Read transcript once into both views (avoids race where mid-load appends
    # cause Pattern-C and Pattern-B to inspect divergent snapshots).
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

    # Pattern B/C: scan agent's bare prose only. Strip code-fenced spans,
    # backticks, and single/double-quoted runs so quoted user input doesn't
    # falsely trip the permission-ask check.
    import re as _re_psy
    raw_final = _last_assistant_text(events)
    stripped = _re_psy.sub(r"```.*?```", " ", raw_final, flags=_re_psy.DOTALL)
    stripped = _re_psy.sub(r"`[^`\n]*`", " ", stripped)
    stripped = _re_psy.sub(r'"[^"\n]*"', " ", stripped)
    stripped = _re_psy.sub(r"'[^'\n]*'", " ", stripped)
    final_text = stripped.lower()
    # Ideation gate (computed once for both Pattern B and C). Suppresses
    # ADMIT-phrase matches when user clearly asked for ideas/comparison;
    # directive markers override. Reuses events_with_user to avoid race.
    user_text = _last_user_text(events_with_user)
    user_is_ideating = _is_ideation_prompt(user_text)
    # Override: if the prior assistant turn claimed completion, the ideation
    # framing is a smokescreen for residual-work enumeration. Don't suppress.
    if user_is_ideating and _prior_assistant_claimed_completion(events_with_user):
        user_is_ideating = False
    if final_text:
        if not user_is_ideating:
            for phrase in ADMIT_PHRASES:
                if phrase in final_text:
                    if not _has_tool_call_after_last_text(events):
                        # (b)-clause rescue: admit-phrase + nearby explicit
                        # refusal-with-reason ("not doing this is right
                        # because...") = sanctioned path, not punt.
                        from _rescue_clauses import b_clause_within_window
                        anchor = final_text.find(phrase)
                        if anchor >= 0 and b_clause_within_window(final_text, anchor):
                            _emit_stats(
                                "ok",
                                f"pattern_B b_clause_rescue admit_phrase={phrase!r}"
                            )
                            print("ok")
                            return 0
                        _emit_stats("psycho", f"pattern_B: admit_phrase={phrase!r}")
                        print("psycho")
                        return 0

        # Pattern C: survey-and-ask -- same ideation gate as Pattern B above.
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
