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


# Prompts where enumeration is the deliverable, not a punt.
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
    # Comparison questions require enumerating equivalents/gaps.
    re.compile(r"\bdoes\s+(our|the|this)\s+\w+\s+(already\s+)?(do|cover|handle|implement|provide)\b", re.IGNORECASE),
    re.compile(r"\b(is|are)\s+(this|that|these|those|we|our|the)\s+\w+\s*(?:already\s+|effectively\s+)?(equivalent|same|covering|comparable)\b", re.IGNORECASE),
    re.compile(r"\b(does|do)\s+(our|the|we|this)\b[^?\n]{0,60}\b(effectively|already|the\s+same|equivalent)\b", re.IGNORECASE),
    # Thorough-sweep prompts may enumerate justified non-implementations.
    re.compile(r"\b(thorough|full|comprehensive|complete|exhaustive)\s+(sweep|review|audit|coverage|integration)\b", re.IGNORECASE),
    re.compile(r"\b(ALL|every)\b[^?\n]{0,80}\b(recommendations?|integrations?|findings?|patterns?|items?|gaps?)\b", re.IGNORECASE),
    re.compile(r"\b(did|are)\s+we\s+(get|cover|catch)\s+(everything|all|the\s+full)\b", re.IGNORECASE),
    re.compile(r"\bwhat'?s\s+(left|missing)\s+(from|after|in)\s+(the|that|this)\s+(sweep|review|integration|audit)\b", re.IGNORECASE),
)


# Agent-initiated permission asks always fire, even on research turns.
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
    """True when the user asked for enumeration/evaluation as the answer."""
    if not user_text:
        return False
    # Implementation requests are not research/evaluation turns.
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


# Import phrase tables from sibling.
from exhaust_check_phrases import DEFERRAL_PHRASES, DEFERRAL_REGEXES  # noqa: E402

# Substantive-work tools and Bash mutation shapes.
_WORK_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}
_BASH_WORK_RE = re.compile(
    r"\b(?:sed\s|awk\s|perl\s+-i|python3?\s+-c\b.*?\bopen\s*\(|"
    r"git\s+(?:apply|commit|merge|rebase|cherry-pick)|"
    r"\bmv\s|\bcp\s|\brm\s|\btee\s|>\s*\S|>>\s*\S)",
    re.IGNORECASE | re.DOTALL,
)


def _substantive_work_count(events: list) -> int:
    """Count concrete code-changing tool uses in this turn."""
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
# List-ish marker after a deferral: bullet, numbered item, or bold header.
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
    """True if any tool_use appears after the last text block."""
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

    # Structural enumeration before phrase rescues; threshold protects SUMMARY.
    _cutoff = int(len(raw_text) * 0.40)
    _closing_items = len(_LIST_ITEM_RE.findall(raw_text[_cutoff:]))
    if _closing_items >= _STRUCTURAL_ENUMERATION_THRESHOLD and not _has_tool_call_after_last_text(events):
        _user_text_struct = _last_user_text(events)
        if not _is_research_evaluation_request(_user_text_struct):
            _emit_stats("exhaust_violation", f"structural_enumeration items={_closing_items} threshold={_STRUCTURAL_ENUMERATION_THRESHOLD}")
            print("exhaust_violation")
            return 0
        _emit_stats("ok", f"structural_enumeration items={_closing_items} but research-eval exemption applies")

    # Substantive-work rescue is narrow: hot-reload narration only.
    n_work = _substantive_work_count(events)
    # 2+ undone bold headers override high work count.
    raw_for_shape = _last_assistant_text(events)
    _UNDONE_HEADER = re.compile(
        r"\*\*[^*]*(?:not (?:wired|fixed|investigated|reported|implemented)|"
        r"half[- ]done|pending|remaining|orphan|deferred|unfinished|missing|"
        r"observation[- ]only|lurking)[^*]*\*\*\s*[:\-]",
        re.IGNORECASE,
    )
    n_undone_headers = len(_UNDONE_HEADER.findall(raw_for_shape))
    # Multi-item SUMMARY what-next clauses are punts in disguise.
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

    # Strip quoted/code-fenced text before phrase matching.
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

    # Closing-position deferrals count even without a list marker.
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
        # Research-evaluation exemption; permission-ask phrases disqualify it.
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
        # (b)-clause rescue permits explicit refusal-with-reason, not punts.
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
