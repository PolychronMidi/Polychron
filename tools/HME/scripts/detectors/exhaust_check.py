#!/usr/bin/env python3
"""Detect "enumerated remaining items as deferral" antipattern.

Sister of early_stop.py. early_stop is *gated* on an open-ended user prompt
("do all", "anything missing", etc.) — it catches the historical pattern
where the agent enumerates work and then stops in response to those prompts.

This detector is *unconditional*: ANY final assistant text that punts work
with a deferral phrase — substring OR structural — gets flagged.

Trigger: assistant's FINAL text contains a deferral signal from *either*:
  (a) DEFERRAL_PHRASES — exact substring match, or
  (b) DEFERRAL_REGEXES — structural patterns like "Remaining <X> gap/work",
      "still haven't fix...", bold-header "## Backlog", "worth another pass",
      etc. (catches phrasings the substring list misses).
AND either:
  (x) ≥1 list marker (bullet or numbered) follows the deferral — even one
      is a literal handoff; the pre-patch threshold of 3+ let single-item
      punts slip through, which was the exact evasion motivating this patch,
      or
  (y) the deferral is in the last 40% of the text (≥200 chars total) —
      closing-summary handoffs don't need bullets to count as a punt.

Usage: exhaust_check.py <transcript_path>
Output: "exhaust_violation" or "ok"
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import load_full_turn_with_user  # noqa: E402


# Phrases that explicitly mark an item as "not done in this turn".
# These should never appear in a closing summary — every enumerated item
# must be either completed or punted with explicit user agreement.
DEFERRAL_PHRASES = (
    "noted not fixed",
    "noted, not fixed",
    "noted not yet fixed",
    "noted, not yet fixed",
    "noted as remaining",
    "remaining tools",
    "remaining items",
    "remaining work",
    "remaining issues",
    "remaining gaps",
    "remaining non-ecstatic",
    "still not fixed",
    "not fixed yet",
    "not yet fixed",
    "not yet implemented",
    "not yet addressed",
    "not yet handled",
    "tbd:",
    "tbd ",
    "(tbd)",
    "[tbd]",
    "to-do:",
    "to do:",
    "todo:",
    "deferred:",
    "deferred to next",
    "punt to next",
    "skipped (not blocking)",
    "left for later",
    "for a future turn",
    "in a follow-up",
    "follow-up turn",
    "next turn could",
    "needs follow-up",
    "for next session",
    "future work:",
    # Added after the "flagging for the backlog" evasion slipped through:
    # the user asked for all fixes; agent punted two items with these phrasings.
    "flagging for the backlog",
    "flag for the backlog",
    "flag for backlog",
    "for the backlog",
    "add to the backlog",
    "rather than attempting now",
    "rather than attempt now",
    "not attempting now",
    "not attempting here",
    "worth a separate",
    "separate follow-up",
    "separate followup",
    "worth a follow-up",
    "worth an i/",        # e.g. "worth an i/status follow-up"
    "worth an hme",
    "non-trivial change",
    "non-trivial; flagging",
    "out of scope for this",
    "outside this session",
    "outside the scope of this",
    "another session",
    "next session could",
    "leaving for the backlog",
    "leaving for later",
    "leaving to later",
    "parking this",
    "parked for later",
    "skip for now",
    "skipping for now",
    "defer for now",
    "deferring for now",
    "won't fix this round",
    "won't fix this session",
    "didn't fix this round",
    "didn't fix this session",
    "didn't fix in this",
    "not fix in this session",
    "left undone",
    "left unfinished",
    "not covered here",
    "not covered in this session",
    "scope creep",
    "separate investigation",
    "a separate pass",
    "a later pass",
    "not this turn",
    "another turn",
    # "Banked / waiting-on-user-action" register. Added after a session where
    # the agent closed with "Still banked (not actionable right now): supervisor
    # fix — takes effect on next proxy restart" and "chat-panel fix — next
    # extension-host reload". Those ARE handoffs, but they wore technical
    # garb and slipped every deferral pattern above. This register catches
    # the "I did my part, waiting on you" frame.
    "still banked",
    "banked for",
    "banked until",
    "takes effect on next",
    "takes effect when",
    "will take effect",
    "on next proxy restart",
    "on next extension",
    "on next session",
    "on next reload",
    "next extension reload",
    "next extension-host reload",
    "requires a restart",
    "requires restart",
    "requires reload",
    "requires a reload",
    "user-initiated",
    "user action required",
    "user action needed",
    "waiting on a restart",
    "waiting on reload",
    "needs a restart",
    "needs a reload",
    "only takes effect",
    "once the proxy restarts",
    "once chat restarts",
    "once the user reloads",
    "when you restart",
    "when you reload",
)

# Regex-based deferral catchers — patterns that carry a handoff even when the
# specific wording escapes the substring list above.
#   - "Remaining Part A gap"/"Remaining X work"/"Remaining Y fix" etc.
#   - "Still [word] for"/"Still [word] to"
#   - Bold-header sections named "Remaining" / "Deferred" / "Backlog" /
#     "Follow-up" / "Known gaps" / "Future" / "TODO"
DEFERRAL_REGEXES = (
    re.compile(
        r"\bremaining\b[^\n]{0,60}?\b("
        r"gap|item|work|issue|bug|task|piece|thing|fix|tool|edit|change|"
        r"finding|opportunit|investigation|cleanup|todo|chore|debt|followup|follow-up"
        r")s?\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(still|not yet|haven'?t|didn'?t|won'?t|can'?t)\b[^\n]{0,40}?"
        r"\b(fix|address|implement|handle|cover|tackle|complete|finish|land|ship|do)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*#{1,6}\s*(remaining|deferred|backlog|follow-?up|future|known gaps?|"
        r"todo|punt|next session|later|out of scope|outstanding)\b",
        re.IGNORECASE | re.MULTILINE,
    ),
    re.compile(
        r"\*\*\s*(remaining|deferred|backlog|follow-?up|future|known gaps?|"
        r"todo|punt|next session|later|out of scope|outstanding)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bworth\s+(a|an|another|more)\b[^\n]{0,40}?"
        r"\b(pass|review|look|investigation|run|follow-?up|round|session)\b",
        re.IGNORECASE,
    ),
    # "Takes effect on next …" / "requires a restart" handoffs — the "I did
    # my part, waiting on you" frame. Structural because the specific
    # wording varies (next proxy restart / next reload / next session / etc.).
    re.compile(
        r"\b(takes|will take)\s+effect\s+(on|when|after)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(requires|needs|waiting\s+on|pending)\s+(a\s+|an\s+)?"
        r"(restart|reload|user\s+action|session\s+restart|extension\s+(host\s+)?reload)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bonce\s+(you\s+|the\s+)?(restart|reload|proxy|chat|panel|session|user)\b",
        re.IGNORECASE,
    ),
    # "I can build/implement/fix that" -- offering future work instead of
    # doing it now. The "I'll do it next time / want me to" frame.
    re.compile(
        r"\bI\s+(can|could|will|would|might|should)\s+"
        r"(build|implement|fix|address|handle|land|ship|do|tackle|"
        r"add|wire|migrate|convert|expand|extend|create|write|set\s+up)\b",
        re.IGNORECASE,
    ),
    # "Want me to" / "Should I" / "Would you like me to" -- punts decision
    # to the user instead of executing under existing authority. Mirrors
    # PSYCHOPATHIC-STOP's survey-and-ask pattern but caught at exhaust time.
    re.compile(
        r"\b(want|need)\s+me\s+to\b|"
        r"\bshould\s+I\b|"
        r"\bwould\s+you\s+(like|want)\s+me\s+to\b|"
        r"\bdo\s+you\s+want\s+me\s+to\b",
        re.IGNORECASE,
    ),
    # "Tell me which" / "let me know" / "point me at" / "specify" --
    # direct handoff to the user for required input.
    re.compile(
        r"\b(tell|let|point|show|give)\s+me\b[^\n]{0,40}?"
        r"\b(which|what|where|the\s+specific|the\s+concrete|to\s+(it|that))\b",
        re.IGNORECASE,
    ),
    # "Pick a direction" / "choose one" / "which option" -- multi-option
    # presentation as substitute for execution.
    re.compile(
        r"\b(pick|choose|select)\s+(a|an|one|which)\b[^\n]{0,40}?"
        r"\b(option|direction|approach|path|route|frontier|move)\b",
        re.IGNORECASE,
    ),
    # Bullet/branch labels with bold-(a)/(b) where final text presents
    # multiple paths as a question to the user.
    re.compile(
        r"^\s*\([a-c]\)\s*\*\*[^*]+\*\*",
        re.MULTILINE,
    ),
)

# A bullet line. The count threshold is intentionally low: even a single
# deferred item is a handoff. The *original* detector required 3+ bullets as
# "proof of enumeration"; in practice that gated the check wide open for
# one- or two-item punts (the exact pattern this detector was born to catch).
_BULLET_LINE = re.compile(r"^\s*[-*•]\s+\S", re.MULTILINE)
# Any list-ish marker after the deferral — bullets, numbered items, OR
# bold-header paragraphs like "**Remaining X:** ..." which are structurally
# equivalent to a bullet in a closing-summary handoff. A one-line punt does
# NOT need markdown list syntax to count.
_ANY_HANDOFF_MARKER = re.compile(
    r"^\s*(?:[-*•]\s+\S|\d+[.)]\s+\S|\*\*[A-Z][^*]*\*\*\s*[:—\-])",
    re.MULTILINE,
)


def _is_assistant(event: dict) -> bool:
    """Real Claude Code transcripts use `type="assistant"` at the top level
    with the message payload nested under `.message` — NOT `role="assistant"`
    at the top level (that shape never appears in practice). The old check
    returned False on every real event, which meant the detector silently
    emitted "ok" on every turn regardless of closing text content. Caught
    Apr 2026 while auditing why exhaust_check never fired on clear evasions.
    """
    if event.get("type") == "assistant":
        return True
    # Back-compat: some synthetic test fixtures use `role` at top level.
    return event.get("role") == "assistant" and bool(event.get("content"))


def _last_assistant_text(events: list) -> str:
    last = None
    for ev in events:
        if _is_assistant(ev):
            last = ev
    if last is None:
        return ""
    # Content lives in one of two places depending on transcript shape:
    #   Real Claude Code: event.message.content = [{type:"text",text:"..."}]
    #   Test fixtures  : event.content = [{type:"text",text:"..."}]
    content = []
    msg = last.get("message")
    if isinstance(msg, dict):
        maybe = msg.get("content")
        if isinstance(maybe, list):
            content = maybe
    if not content:
        maybe = last.get("content")
        if isinstance(maybe, list):
            content = maybe
    parts = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            t = block.get("text", "")
            if isinstance(t, str):
                parts.append(t)
    return "\n".join(parts)


def _emit_stats(verdict: str, detail: str) -> None:
    """Best-effort telemetry. Mirrors early_stop's emit pattern."""
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
                "ts": _time.time(),
                "detector": "exhaust_check",
                "verdict": verdict,
                "detail": detail,
            }) + "\n")
    except (OSError, TypeError, ValueError) as _emit_err:
        # Telemetry only, never block hook — but narrow the catch so real
        # bugs (NameError from missing imports, AttributeError from schema
        # drift) propagate to stderr instead of silently hiding for months.
        import sys as _sys
        print(f"[exhaust_check] stats emit failed: "
              f"{type(_emit_err).__name__}: {_emit_err}", file=_sys.stderr)


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_full_turn_with_user(sys.argv[1])
    raw_text = _last_assistant_text(events)
    if not raw_text:
        _emit_stats("ok", "no_final_text")
        print("ok")
        return 0

    # Strip quoted / code-fenced content before phrase-matching. Without
    # this, a response that quoted user prompts or test fixtures
    # (e.g. `Directive markers still dominate — "fix"/"implement"/"do all"`)
    # tripped the `still ... fix|implement|do` regex even though the verbs
    # were inside quotes describing behavior, not the agent's own deferral.
    # Strip targets: ```fenced```, `inline`, "double" and 'single' quoted
    # spans on a single line.
    stripped_text = re.sub(r"```.*?```", " ", raw_text, flags=re.DOTALL)
    stripped_text = re.sub(r"`[^`\n]*`", " ", stripped_text)
    stripped_text = re.sub(r'"[^"\n]*"', " ", stripped_text)
    stripped_text = re.sub(r"'[^'\n]*'", " ", stripped_text)
    text = stripped_text
    text_l = text.lower()

    # Phase 1: substring phrase list.
    matched_phrase = None
    matched_pos = -1
    for phrase in DEFERRAL_PHRASES:
        idx = text_l.find(phrase)
        if idx != -1 and (matched_pos == -1 or idx < matched_pos):
            matched_phrase = phrase
            matched_pos = idx

    # Phase 2: regex patterns catch the structural cases the phrase list
    # misses (e.g. "Remaining Part A gap I didn't fix" — the word between
    # "Remaining" and "gap" defeats substring matching).
    regex_match_label = None
    regex_match_pos = -1
    for pat in DEFERRAL_REGEXES:
        m = pat.search(text)
        if m is None:
            continue
        if regex_match_pos == -1 or m.start() < regex_match_pos:
            regex_match_label = f"regex:{pat.pattern[:40]}…"
            regex_match_pos = m.start()

    # Take the earliest of the two signals as the effective deferral point.
    # If neither fires, nothing to flag.
    candidates = [
        (matched_pos, matched_phrase) if matched_pos != -1 else None,
        (regex_match_pos, regex_match_label) if regex_match_pos != -1 else None,
    ]
    candidates = [c for c in candidates if c is not None]
    if not candidates:
        _emit_stats("ok", "no_deferral_phrase")
        print("ok")
        return 0
    candidates.sort(key=lambda c: c[0])
    deferral_pos, deferral_label = candidates[0]

    # Position check: a deferral appearing in the *closing* portion of the
    # text is almost certainly a handoff-summary, even without a bullet list.
    # Two overlapping heuristics:
    #   (a) last 40% of text (was 60% → tightened to 60% prefix / 40% suffix),
    #   (b) within the last 400 chars regardless of ratio — catches "closing
    #       paragraph" handoffs in shorter messages where 40% would exclude.
    # Mid-text passing mentions ("previously TBD but I just fixed it") need
    # to survive BOTH checks to escape, which requires them to appear in the
    # first 60% AND more than 400 chars from the end.
    text_len = len(text)
    in_closing = text_len > 200 and (
        deferral_pos >= int(text_len * 0.60)
        or (text_len - deferral_pos) <= 400
    )

    # Count ANY handoff markers after the deferral point. Bullets (`- `,
    # `* `) or numbered items (`1.`). Even one is enough to prove a literal
    # enumerated punt — the old 3+ threshold made single-item deferrals
    # invisible, which was the exact evasion that motivated this patch.
    after = text[deferral_pos:]
    bullet_count = sum(1 for _ in _BULLET_LINE.finditer(after))
    handoff_count = sum(1 for _ in _ANY_HANDOFF_MARKER.finditer(after))

    if handoff_count >= 1 or in_closing:
        reason = (
            f"deferral={deferral_label!r} bullets_after={bullet_count} "
            f"handoff_markers={handoff_count} in_closing={in_closing} "
            f"pos={deferral_pos}/{text_len}"
        )
        _emit_stats("exhaust_violation", reason)
        print("exhaust_violation")
        return 0

    _emit_stats("ok", f"deferral={deferral_label!r} but no handoff markers and not in closing")
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
