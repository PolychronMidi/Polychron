#!/usr/bin/env python3
"""Detect "enumerated remaining items as deferral" antipattern.

Sister of early_stop.py. early_stop is *gated* on an open-ended user prompt
("do all", "anything missing", etc.) -- it catches the historical pattern
where the agent enumerates work and then stops in response to those prompts.

This detector is *unconditional*: ANY final assistant text that punts work
with a deferral phrase -- substring OR structural -- gets flagged.

Trigger: assistant's FINAL text contains a deferral signal from *either*:
  (a) DEFERRAL_PHRASES -- exact substring match, or
  (b) DEFERRAL_REGEXES -- structural patterns like "Remaining <X> gap/work",
      "still haven't fix...", bold-header "## Backlog", "worth another pass",
      etc. (catches phrasings the substring list misses).
AND either:
  (x) >=1 list marker (bullet or numbered) follows the deferral -- even one
      is a literal handoff; the pre-patch threshold of 3+ let single-item
      punts slip through, which was the exact evasion motivating this patch,
      or
  (y) the deferral is in the last 40% of the text (>=200 chars total) --
      closing-summary handoffs don't need bullets to count as a punt.

Usage: exhaust_check.py <transcript_path>
Output: "exhaust_violation" or "ok"
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import is_user, event_content, iter_tool_uses, load_full_turn_with_user  # noqa: E402
from _rescue_clauses import b_clause_within_window  # noqa: E402


# User-prompt phrases that explicitly invite evaluation/enumeration as the
# deliverable. When the user's prompt this turn matches one of these AND the
# assistant's closing text is a structural enumeration (bullets, ## Future
# headers, etc.) WITHOUT survey-and-ask language ("want me to", "should I"),
# the enumeration IS the answer -- not a punt. Suppress the violation in that
# case so the agent can end the turn silently.
#
# Conservative: this list only contains UNAMBIGUOUS evaluation invitations.
# A request that mixes "evaluate AND fix" doesn't get exemption -- the user
# wants the fix done, the enumeration is incidental.
RESEARCH_INVITATION_PATTERNS = (
    re.compile(r"\bwhat\s+(does|do|might)\b[^?\n]{0,80}\b(have\s+to\s+offer|offer)\b", re.IGNORECASE),
    re.compile(r"\b(worth\s+(integrating|learning|borrowing|adopting|considering))\b", re.IGNORECASE),
    re.compile(r"\b(evaluate|review|compare|research|survey|assess|inspect|examine)\s+(this|that|these|the|their|its)\b", re.IGNORECASE),
    re.compile(r"\b(tell\s+me\s+about|look\s+at|check\s+out)\s+(this|that|the|their|its)\s+(project|repo|library|framework|tool|approach|design|pattern)\b", re.IGNORECASE),
    re.compile(r"\b(enumerate|list)\s+(every|all|the|its|their)\b", re.IGNORECASE),
    re.compile(r"\bcontinue\s+(researching|the\s+research|to\s+research)\b", re.IGNORECASE),
    re.compile(r"\b(comparison|evaluation|assessment|review)\s+of\b", re.IGNORECASE),
    re.compile(r"\bdo\s+(they|we|you)\s+(have|all\s+have)\b[^?\n]{0,40}\b(persisted|persistent|context)\b", re.IGNORECASE),
    re.compile(r"\b(how\s+do\s+they|how\s+does\s+it|how\s+does\s+that)\s+(communicate|work|coordinate|persist)\b", re.IGNORECASE),
    re.compile(r"\bcompared\s+to\b", re.IGNORECASE),
    re.compile(r"\bI\s+(present|am\s+presenting)\s+you\b", re.IGNORECASE),
    re.compile(r"\b(secretly\s+have|might\s+(secretly\s+)?(have|offer))\b[^?\n]{0,60}\b(more|much\s+more)\b", re.IGNORECASE),
    # Comparison questions: "does our system already do what X does?",
    # "is this equivalent to Y?", "are we covering the same ground as Z?"
    # The answer requires enumerating equivalents/gaps; the enumeration
    # IS the deliverable, not a punt.
    re.compile(r"\bdoes\s+(our|the|this)\s+\w+\s+(already\s+)?(do|cover|handle|implement|provide)\b", re.IGNORECASE),
    re.compile(r"\b(is|are)\s+(this|that|these|those|we|our|the)\s+\w+\s*(?:already\s+|effectively\s+)?(equivalent|same|covering|comparable)\b", re.IGNORECASE),
    re.compile(r"\b(does|do)\s+(our|the|we|this)\b[^?\n]{0,60}\b(effectively|already|the\s+same|equivalent)\b", re.IGNORECASE),
    # Thorough-sweep closeouts: when the user prompt explicitly invites
    # comprehensive coverage ("thorough sweep", "full sweep", "ALL of
    # the recommendations", "did we get everything"), the closeout is
    # allowed to enumerate out-of-scope / not-implemented items as long
    # as each carries a stated reason. Without this exemption, the
    # legitimate-deferral list (with reasons) fires the same gate as a
    # silent punt -- forcing the agent to either implement out-of-scope
    # items or restructure responses to hide what wasn't done. Both
    # waste effort. The implementation-done items in the same response
    # carry their own evidence (tests, file paths) so a real silent
    # punt would still be caught by other detectors (early_stop,
    # psycho_stop) which gate on prior-deny / no-tool-calls.
    re.compile(r"\b(thorough|full|comprehensive|complete|exhaustive)\s+(sweep|review|audit|coverage|integration)\b", re.IGNORECASE),
    re.compile(r"\b(ALL|every)\b[^?\n]{0,80}\b(recommendations?|integrations?|findings?|patterns?|items?|gaps?)\b", re.IGNORECASE),
    re.compile(r"\b(did|are)\s+we\s+(get|cover|catch)\s+(everything|all|the\s+full)\b", re.IGNORECASE),
    re.compile(r"\bwhat'?s\s+(left|missing)\s+(from|after|in)\s+(the|that|this)\s+(sweep|review|integration|audit)\b", re.IGNORECASE),
)


# Phrases that ALWAYS fire regardless of research-context exemption. These
# are agent-initiated punts that the user did not invite -- survey-and-ask,
# I-can-do-X-later, etc. Even on a research turn, asking permission instead
# of executing or offering future work instead of doing it now is a punt.
ALWAYS_FIRE_PHRASES = (
    "want me to",
    "should i ",
    "shall i ",
    "would you like me to",
    "do you want me to",
    "let me know if",
    "noted but not fixed",
    "noted, not fixed",
    "noted not fixed",
    "still not fixed",
    "didn't fix this",
    "won't fix this",
    "i can build",
    "i can implement",
    "i could build",
    "i could implement",
    "i'll build",
    "i'll implement",
)


def _last_user_text(events: list) -> str:
    """Extract the last user message's text content. Mirrors
    _last_assistant_text but for the user side. Returns '' if no user
    message present (sole-assistant transcripts shouldn't happen, but
    be defensive)."""
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
    # Some user events nest text under .message.content as a plain string.
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


def _is_research_evaluation_request(user_text: str) -> bool:
    """True if the user's prompt this turn is unambiguously inviting
    enumeration/evaluation as the deliverable. Scoped narrowly to avoid
    false-suppression: a prompt that mixes "evaluate AND fix" does not
    qualify -- the user wants the fix done, not just analyzed."""
    if not user_text:
        return False
    # Disqualify if the prompt also explicitly asks for implementation. A
    # request like "evaluate this AND build the top picks" is implementation
    # work, not research; the deferral suppression must not apply.
    impl_signal = re.search(
        r"\b(implement|build\s+(?!that\b)|integrate(?!\s+(would|might|could))|"
        r"add\s+(it|them|these)|wire\s+up|merge\s+in|land\s+(it|them|these)|"
        r"do\s+(all|each|the)\s+(of\s+)?(these|those|them))\b",
        user_text,
        re.IGNORECASE,
    )
    if impl_signal:
        return False
    for pat in RESEARCH_INVITATION_PATTERNS:
        if pat.search(user_text):
            return True
    return False


# Phrases that explicitly mark an item as "not done in this turn".
# These should never appear in a closing summary -- every enumerated item
# must be either completed or punted with explicit user agreement.

# Import phrase tables from sibling.
from exhaust_check_phrases import DEFERRAL_PHRASES, DEFERRAL_REGEXES  # noqa: E402

# Substantive-work tools (Edit/Write/MultiEdit/NotebookEdit) and the
# Bash command shapes that mutate files. Mirrors advisor_doctrine's
# implicit-solo logic: a turn that did real work is not punting, even
# if its closing prose happens to match a deferral phrase.
_WORK_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}
_BASH_WORK_RE = re.compile(
    r"\b(?:sed\s|awk\s|perl\s+-i|python3?\s+-c\b.*?\bopen\s*\(|"
    r"git\s+(?:apply|commit|merge|rebase|cherry-pick)|"
    r"\bmv\s|\bcp\s|\brm\s|\btee\s|>\s*\S|>>\s*\S)",
    re.IGNORECASE | re.DOTALL,
)


def _substantive_work_count(events: list) -> int:
    """Count concrete code-changing tool uses in this turn. Threshold
    used downstream is >= 3 for the implicit-solo rescue."""
    n = 0
    for ev in events:
        msg = ev.get("message")
        content = msg.get("content") if isinstance(msg, dict) else ev.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            name = block.get("name", "")
            if name in _WORK_TOOLS:
                n += 1
                continue
            if name == "Bash":
                cmd = (block.get("input") or {}).get("command", "") or ""
                if _BASH_WORK_RE.search(cmd):
                    n += 1
    return n


_BULLET_LINE = re.compile(r"^\s*[-**]\s+\S", re.MULTILINE)
# Any list-ish marker after the deferral -- bullets, numbered items, OR
# bold-header paragraphs like "**Remaining X:** ..." which are structurally
# equivalent to a bullet in a closing-summary handoff. A one-line punt does
# NOT need markdown list syntax to count.
_ANY_HANDOFF_MARKER = re.compile(
    r"^\s*(?:[-**]\s+\S|\d+[.)]\s+\S|\*\*[A-Z][^*]*\*\*\s*[:\-])",
    re.MULTILINE,
)


def _is_assistant(event: dict) -> bool:
    """Real Claude Code transcripts use `type="assistant"` at the top level
    with the message payload nested under `.message` -- NOT `role="assistant"`
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
    from _detector_stats import emit_stats
    emit_stats("exhaust_check", verdict, detail)


_LIST_ITEM_RE = re.compile(r"^\s*(?:\d+[.)]\s+\S|[-*]\s+\S)", re.MULTILINE)
_STRUCTURAL_ENUMERATION_THRESHOLD = 3


def _has_tool_call_after_last_text(events: list) -> bool:
    """Mirror of psycho_stop._has_tool_call_after_last_text. True if any tool_use appears after the last text block in the turn -- legitimate work-then-summarize sequences must escape via this path."""
    last_text_event_idx = -1
    last_text_block_idx = -1
    for i, ev in enumerate(events):
        if ev.get("type") != "assistant":
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

    # Structural enumeration check -- runs before phrase-based rescues. Fires when closing 60% of final text has >=3 line-start list items AND no tool_use follows the last text block. Threshold 3 protects SUMMARY's single what's-next bullet. Exempts research-eval prompts where enumeration IS the deliverable (mirrors the same exemption the phrase-based path applies later in this function).
    _cutoff = int(len(raw_text) * 0.40)
    _closing_items = len(_LIST_ITEM_RE.findall(raw_text[_cutoff:]))
    if _closing_items >= _STRUCTURAL_ENUMERATION_THRESHOLD and not _has_tool_call_after_last_text(events):
        _user_text_struct = _last_user_text(events)
        if not _is_research_evaluation_request(_user_text_struct):
            _emit_stats("exhaust_violation", f"structural_enumeration items={_closing_items} threshold={_STRUCTURAL_ENUMERATION_THRESHOLD}")
            print("exhaust_violation")
            return 0
        _emit_stats("ok", f"structural_enumeration items={_closing_items} but research-eval exemption applies")

    # Implicit-solo / substantive-work rescue. If this turn did >= 3
    # concrete code-changing tool calls (Edit/Write/MultiEdit or Bash
    # shapes that mutate files), the agent fixed things rather than
    # punting. The deferral-phrase heuristic produces false positives
    # on legitimate work-completion narration ("the change takes effect
    # on next Stop event" describes immediate hot-reload, not a punt).
    # Mirrors the rescue we landed in advisor_doctrine for the same
    # cascade-noise failure mode.
    n_work = _substantive_work_count(events)
    # 2+ bold-header categories of UNDONE work in closing = structural punt even with high work count.
    raw_for_shape = _last_assistant_text(events)
    _UNDONE_HEADER = re.compile(
        r"\*\*[^*]*(?:not (?:wired|fixed|investigated|reported|implemented)|"
        r"half[- ]done|pending|remaining|orphan|deferred|unfinished|missing|"
        r"observation[- ]only|lurking)[^*]*\*\*\s*[:\-]",
        re.IGNORECASE,
    )
    n_undone_headers = len(_UNDONE_HEADER.findall(raw_for_shape))
    # SUMMARY-block "what's next:" bullets with semicolon-separated multi-item lists are punts in disguise. Scope to the SUMMARY block region (post-banner) so prose containing the phrase elsewhere isn't a false positive.
    whats_next_punt = False
    _SUMMARY_BANNER = re.compile(r"={3,}\s*SUMMARY\s*={3,}", re.IGNORECASE)
    banner_m = _SUMMARY_BANNER.search(raw_for_shape)
    if banner_m:
        summary_region = raw_for_shape[banner_m.end():]
        _WHATS_NEXT_MULTI = re.compile(r"what.{0,2}s\s+next\s*:\s*[^\n]*?;\s*\w", re.IGNORECASE)
        whats_next_punt = bool(_WHATS_NEXT_MULTI.search(summary_region))
    if n_work >= 3 and n_undone_headers < 2 and not whats_next_punt:
        safe_work_narration = re.compile(
            r"\b(takes|will take)\s+effect\s+(on|when|after)\b|"
            r"\b(requires|needs|waiting\s+on|pending)\s+(a\s+|an\s+)?"
            r"(restart|reload|user\s+action|session\s+restart|extension\s+(host\s+)?reload)\b|"
            r"\bonce\s+(you\s+|the\s+)?(restart|reload|proxy|session|user)\b",
            re.IGNORECASE,
        )
        if safe_work_narration.search(raw_for_shape):
            _emit_stats("ok", f"implicit_solo_work_count={n_work} undone_headers={n_undone_headers} whats_next_punt=False")
            print("ok")
            return 0
        _emit_stats("noted", f"work_count={n_work} but deferral scan still required")
    if whats_next_punt:
        _emit_stats("noted", f"work_count={n_work} but SUMMARY what's-next is multi-item enumeration -- proceeding to phrase scan")
    elif n_undone_headers >= 2:
        _emit_stats("noted", f"work_count={n_work} but undone_headers={n_undone_headers} -- proceeding to phrase scan")

    # Strip quoted / code-fenced content before phrase-matching. Without
    # this, a response that quoted user prompts or test fixtures
    # (e.g. `Directive markers still dominate -- "fix"/"implement"/"do all"`)
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
    # misses (e.g. "Remaining Part A gap I didn't fix" -- the word between
    # "Remaining" and "gap" defeats substring matching).
    regex_match_label = None
    regex_match_pos = -1
    for pat in DEFERRAL_REGEXES:
        m = pat.search(text)
        if m is None:
            continue
        if regex_match_pos == -1 or m.start() < regex_match_pos:
            regex_match_label = f"regex:{pat.pattern[:40]}..."
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
    #   (a) last 40% of text (was 60% -> tightened to 60% prefix / 40% suffix),
    #   (b) within the last 400 chars regardless of ratio -- catches "closing
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
    # enumerated punt -- the old 3+ threshold made single-item deferrals
    # invisible, which was the exact evasion that motivated this patch.
    after = text[deferral_pos:]
    bullet_count = sum(1 for _ in _BULLET_LINE.finditer(after))
    handoff_count = sum(1 for _ in _ANY_HANDOFF_MARKER.finditer(after))

    if handoff_count >= 1 or in_closing:
        # Research-evaluation exemption: when user invited enumeration as
        # deliverable AND closing has no survey-and-ask / I-can-X patterns,
        # the enumeration IS the answer. Disqualified by ALWAYS_FIRE_PHRASES
        # (want-me-to / should-I / I-can-build / noted-but-not-fixed) or
        # mixed evaluate+implement prompts.
        always_fire_hit = None
        for ph in ALWAYS_FIRE_PHRASES:
            if ph in text_l:
                always_fire_hit = ph
                break
        user_text = _last_user_text(events)
        is_research_turn = _is_research_evaluation_request(user_text)
        if is_research_turn and always_fire_hit is None:
            _emit_stats(
                "ok",
                f"research_exemption deferral={deferral_label!r} "
                f"user_invited_enumeration=True always_fire=None"
            )
            print("ok")
            return 0
        # (b)-clause rescue: the EXHAUST deny message says "Every
        # enumerated item must be fixed in the same turn." But the
        # SCOPE_ESCAPE deny -- same gate family -- explicitly sanctions
        # "explain why fixing is the wrong move" as an alternative path.
        # When the agent enumerates items WITH a refusal-with-reason
        # (b)-clause justification, that's the sanctioned path, not a
        # punt. Suppress to keep the detector consistent with the
        # advertised rule. ALWAYS_FIRE_PHRASES still disqualify because
        # those are agent-initiated punts ("want me to", "noted not
        # fixed") that no reasoning rescues.
        if always_fire_hit is None and b_clause_within_window(text, deferral_pos):
            _emit_stats(
                "ok",
                f"b_clause_rescue deferral={deferral_label!r} "
                f"pos={deferral_pos}/{text_len}"
            )
            print("ok")
            return 0
        reason = (
            f"deferral={deferral_label!r} bullets_after={bullet_count} "
            f"handoff_markers={handoff_count} in_closing={in_closing} "
            f"pos={deferral_pos}/{text_len} "
            f"research_turn={is_research_turn} always_fire={always_fire_hit!r}"
        )
        _emit_stats("exhaust_violation", reason)
        print("exhaust_violation")
        return 0

    _emit_stats("ok", f"deferral={deferral_label!r} but no handoff markers and not in closing")
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
