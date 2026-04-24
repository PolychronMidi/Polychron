#!/usr/bin/env python3
"""Detect early-stop on open-ended HME/chat/tooling rounds.

Pattern (the "enumerate-and-ceremony" antipattern from 2026-04-23):

  1. User message signals open-ended continuation of prior HME work
     ("do all", "anything missing", "next suggestions", "push further",
     "followups", "keep going", "improve X", "make Y better", …).

  2. Agent's FINAL assistant text contains a "what remains" checklist
     ("what's missing", "here's what's left", "pick any to queue",
     "deferred for dedicated review", "remaining gaps", …) AND the
     enumerated items are the same kind of substantive work the user
     just asked to continue.

  3. No tool calls fire after that final text block — the agent stopped
     after writing the checklist instead of executing through it.

That pattern triggered six-plus "anything missing? / do all" ceremony
rounds in a row before the user asked for enforcement. This detector
makes the Stop hook flip to block when those three signals align.

Narrow-scope user prompts ("rename foo to bar", "just fix the one bug",
"don't touch X") explicitly override — the protocol is for open-ended
"improve HME" rounds where the user signalled continuous motion.

Usage: early_stop.py <transcript_path>
Output: "early_stop" or "ok"
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import (  # noqa: E402
    iter_tool_uses, load_full_turn_with_user,
    is_assistant, is_user, event_content,
)


# ─── Signal 1: user prompt signals open-ended continuation ───

OPEN_ENDED_PROMPTS = (
    "do all",
    "anything missing",
    "what's missing",
    "whats missing",
    "what is missing",
    "next suggestions",
    "next suggested",
    "next improvements",
    "next followups",
    "followups",
    "follow-ups",
    "follow ups",
    "keep going",
    "keep pushing",
    "push further",
    "push until",
    "push an infinite",
    "continue through",
    "make it more",
    "make x more",
    "improve x",
    "improve hme",
    "make hme",
    "go deeper",
    "one level deeper",
    "exhaust",
    "exhaust protocol",
    "fully pull",
    "capstone",
    # Expanded 2026-04-23 after the catastrophic-failure debut: the
    # detector stopped me in the very turn that built it. These are the
    # prompts that were active in that session and should now match.
    "go bigger",
    "tackle them",
    "tackle all",
    "solve all",
    "resolve all",
    "one more round",
    "one more pass",
    "another pass",
    "another round",
    "go further",
    "further improvements",
    "more improvements",
    "more followups",
    "ecstatic to think about",
    "ecstatic to even think",
    "meta solution",
    "meta-solution",
    "capstone solution",
    "hypermeta",
    "subquantum",
    "interstellar",
    "until there's no more",
    "catastrophic failure",
    "catostrophic failure",
)

# Narrow-scope overrides — if these appear, the user has bounded the
# work and early-stop is legitimate.
NARROW_SCOPE_OVERRIDES = (
    "rename",
    "just fix",
    "only fix",
    "don't touch",
    "do not touch",
    "don't modify",
    "do not modify",
    "stop after",
    "only do",
    "just the",
    "nothing else",
    "and nothing else",
)


# ─── Signal 2: final text shows "enumerated-but-didn't-execute" shape ───

ENUMERATION_PHRASES = (
    "what remains",
    "what's missing",
    "whats missing",
    "what is missing",
    "what's still missing",
    "still missing",
    "remaining gaps",
    "remaining items",
    "what's left",
    "whats left",
    "pick any to queue",
    "pick what you want",
    "pick any",
    "want me to tackle",
    "want me to do",
    "want me to start",
    "want me to build",
    "here's what's left",
    "here's what remains",
    "here are the remaining",
    "low-leverage polish",
    "deferred for dedicated review",
    "for focused verification time",
    "spin up next",
    "queue next",
    "what's actually missing",
    "whats actually missing",
    # "final-final" / stopping-for-effect language
    "what's still missing now",
    "final-final",
    "final final",
    "these are real but small",
    "honest, final",
    "honest list",
    "genuinely low-leverage",
    # Expanded 2026-04-23 from the catastrophic-failure debut turn. The
    # final text of that turn used these exact phrases without them
    # triggering the detector — they are now load-bearing members of
    # the list.
    "pick any to spin",
    "queue next",
    "the next time",
    "nothing to queue",
    "each is a",
    "minute focused task",
    "minute task",
    "hour focused",
    "hour task",
    "small effort once",
    "medium effort",
    "large effort",
    "low-leverage nit",
    "polish",
    "worth doing but",
    "not blocking",
    "deferred for",
    "deferred to",
    "leaves room for",
    "future round",
    "next round could",
    "would benefit from",
    "could benefit from",
    "nice-to-have",
    "nice to have",
    # Expanded 2026-04-23 (round 2). The closing of the prior turn used
    # "Round complete... two minor UX gaps left as-is" — explicit
    # enumeration-with-deferral that the detector missed because none of
    # those exact phrasings were members. Adding the smoking-gun closures
    # plus the "minor"/"small"/"polish" minimizers that pair with them.
    "round complete",
    "left as-is",
    "left as is",
    "leaving as-is",
    "leaving as is",
    "ux gap",
    "ux gaps",
    "minor gap",
    "minor gaps",
    "minor ux",
    "noted but not",
    "noted as observation",
    "noted as observations",
    "logged but not",
    "for now noted",
    "noted for now",
    "won't fix",
    "wont fix",
    "skipped for",
    "skipping for",
    "skipped — ",
    "skipped --",
    "out of scope for this",
    "outside scope of this",
    "deferred this round",
    "next session can",
    "future session",
    "follow-up session",
    "followup session",
)


def _is_assistant(event: dict) -> bool:
    return is_assistant(event)


def _last_user_text(events: list) -> str:
    """The triggering user message text (first user event in turn-with-user)."""
    for ev in events:
        if not is_user(ev):
            continue
        content = event_content(ev)
        if not content:
            # `content` may be a raw string on user messages (not a list).
            raw = ev.get("message", {}).get("content") if isinstance(ev.get("message"), dict) else ev.get("content")
            if isinstance(raw, str):
                return raw.lower()
            return ""
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts).lower()
    return ""


def _last_assistant_text(events: list) -> str:
    last = None
    for ev in events:
        if _is_assistant(ev):
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


def _has_tool_call_after_last_text(events: list) -> bool:
    """True if any tool_use appears after the last text block in the turn.
    Mirrors the same logic psycho_stop uses — "said it and did it" vs
    "said it and stopped"."""
    last_text_event_idx = -1
    last_text_block_idx = -1
    for i, ev in enumerate(events):
        if not _is_assistant(ev):
            continue
        content = event_content(ev)
        for bi, block in enumerate(content):
            if isinstance(block, dict) and block.get("type") == "text":
                last_text_event_idx = i
                last_text_block_idx = bi
    if last_text_event_idx < 0:
        return False
    last_ev = events[last_text_event_idx]
    content = event_content(last_ev)
    for bi in range(last_text_block_idx + 1, len(content)):
        block = content[bi]
        if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name"):
            return True
    for ev in events[last_text_event_idx + 1:]:
        for tu in iter_tool_uses(ev):
            if tu.get("name"):
                return True
    return False


def _emit_stats(pattern: str, detail: str) -> None:
    """Best-effort telemetry append. Never raises."""
    import json as _json
    import os as _os
    import time as _time
    try:
        root = _os.environ.get("PROJECT_ROOT")
        if not root:
            here = Path(__file__).resolve()
            for parent in [here.parent, *here.parents]:
                if (parent / "CLAUDE.md").exists() and (parent / ".env").exists():
                    root = str(parent)
                    break
        if not root:
            return
        out = _os.path.join(root, "output", "metrics", "detector-stats.jsonl")
        _os.makedirs(_os.path.dirname(out), exist_ok=True)
        with open(out, "a", encoding="utf-8") as f:
            f.write(_json.dumps({
                "ts": _time.time(), "detector": "early_stop",
                "verdict": pattern, "detail": detail,
            }) + "\n")
    except (OSError, TypeError, ValueError) as _emit_err:
        # Observability only, never block — but narrowed so real bugs
        # surface to stderr instead of vanishing into a bare except.
        import sys as _sys
        print(f"[early_stop] stats emit failed: "
              f"{type(_emit_err).__name__}: {_emit_err}", file=_sys.stderr)


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_full_turn_with_user(sys.argv[1])

    user_text = _last_user_text(events)
    if not user_text:
        _emit_stats("ok", "no_user_text")
        print("ok")
        return 0

    # Narrow-scope override: user explicitly bounded the work.
    for narrow in NARROW_SCOPE_OVERRIDES:
        if narrow in user_text:
            _emit_stats("ok", f"narrow_scope={narrow!r}")
            print("ok")
            return 0

    # Signal 1: did the user ask for open-ended continuation?
    matched_open = None
    for phrase in OPEN_ENDED_PROMPTS:
        if phrase in user_text:
            matched_open = phrase
            break
    if matched_open is None:
        _emit_stats("ok", "not_open_ended")
        print("ok")
        return 0

    # Signal 2: does the final assistant text show enumerate-but-didnt-execute?
    final_text = _last_assistant_text(events).lower()
    if not final_text:
        _emit_stats("ok", "no_final_text")
        print("ok")
        return 0
    matched_enum = None
    for phrase in ENUMERATION_PHRASES:
        if phrase in final_text:
            matched_enum = phrase
            break
    if matched_enum is None:
        _emit_stats("ok", f"open({matched_open!r}) but no enumeration")
        print("ok")
        return 0

    # Signal 3: no tool calls after the final text block.
    if _has_tool_call_after_last_text(events):
        _emit_stats("ok", f"enumerated+executed: enum={matched_enum!r}")
        print("ok")
        return 0

    _emit_stats(
        "early_stop",
        f"open={matched_open!r} enum={matched_enum!r}",
    )
    print("early_stop")
    return 0


if __name__ == "__main__":
    sys.exit(main())
