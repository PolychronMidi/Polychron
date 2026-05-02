#!/usr/bin/env python3
"""Detect "skip-fixing-by-calling-it-pre-existing" antipattern.

Sister of exhaust_check.py. exhaust_check catches verbal deferrals
("noted not fixed", "remaining work"). scope_escape catches the more
slippery move: the agent SEES a problem, then defangs it by labeling it
pre-existing / unrelated / not-introduced-here, and stops.

Born from a user correction: agent ran a shell-undefined-vars audit,
saw 4 issues, said "pre-existing issues in unrelated files; my two new
hook scripts are clean", and stopped. The user response: "fix the stop
work / exhaust hooks so that you can never skip fixing problems because
they are 'pre-existing' or 'in unrelated files'."

Detection logic mirrors exhaust_check:
  (a) substring or structural match on a SCOPE_ESCAPE phrase, AND
  (b) the phrase appears in the closing portion of the text (last 40%
      of the response or within the last 400 chars), OR there is at
      least one bullet/numbered/bold-label marker after the phrase
      (a literal handoff).

The "pre-existing" register has a narrow legitimate use ("the test
failure was pre-existing AND I fixed it"). To avoid false-firing on
those, an "AND I fixed it" / "and resolved" / "now fixed" rescue clause
within ~120 chars after the escape phrase suppresses the violation. If
you said you fixed it, the regex believes you (an actual lie surfaces
elsewhere via fabrication_check).

Usage: scope_escape.py <transcript_path>
Output: "scope_escape_violation" or "ok"
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _phrase_lists import SCOPE_ESCAPE  # noqa: E402
from _transcript import load_full_turn_with_user  # noqa: E402


# Suppress when the agent CLAIMS to have fixed the same problem in the
# same breath. Window: 120 chars after the escape phrase. The fabrication
# detector handles the "claimed fix that didn't happen" case separately.
RESCUE_RES = (
    re.compile(r"\b(and|but)\s+(i\s+)?(fixed|resolved|patched|repaired|addressed|cleaned\s+(it\s+)?up|handled\s+it)\b", re.IGNORECASE),
    re.compile(r"\b(now|already)\s+(fixed|resolved|patched|repaired|addressed|cleaned\s+up|handled)\b", re.IGNORECASE),
    re.compile(r"\bi\s+(fixed|resolved|patched|repaired|addressed|cleaned\s+up|handled)\s+(it|them|that)\b", re.IGNORECASE),
    re.compile(r"\bfixed\s+(it|them|that)\s+(anyway|too|as\s+well|while\s+(I\s+was|here))\b", re.IGNORECASE),
)

# Backwards rescue: agent already wrote "Fixed X" / "Resolved Y" within
# 80 chars BEFORE the escape phrase. Catches the past-tense form
# ("Fixed pre-existing missing import in foo") that the forward window
# can't see.
RESCUE_BACKWARD_RES = (
    re.compile(r"\b(fixed|resolved|patched|repaired|addressed|cleaned\s+up|handled)\b[^.\n]{0,80}$", re.IGNORECASE),
)

# (b)-clause rescue: the SCOPE_ESCAPE deny message itself enumerates the
# valid alternative -- "say so explicitly and explain why fixing is the
# wrong move". Shared with exhaust_check / psycho_stop via _rescue_clauses.
from _rescue_clauses import b_clause_within_window  # noqa: E402


def _is_assistant(event: dict) -> bool:
    if event.get("type") == "assistant":
        return True
    return event.get("role") == "assistant" and bool(event.get("content"))


def _last_assistant_text(events: list) -> str:
    last = None
    for ev in events:
        if _is_assistant(ev):
            last = ev
    if last is None:
        return ""
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


_ANY_HANDOFF_MARKER = re.compile(
    r"^\s*(?:[-**]\s+\S|\d+[.)]\s+\S|\*\*[A-Z][^*]*\*\*\s*[:\-])",
    re.MULTILINE,
)


def _emit_stats(verdict: str, detail: str) -> None:
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
                "detector": "scope_escape",
                "verdict": verdict,
                "detail": detail,
            }) + "\n")
    except (OSError, TypeError, ValueError) as _emit_err:
        import sys as _sys
        print(f"[scope_escape] stats emit failed: "
              f"{type(_emit_err).__name__}: {_emit_err}", file=_sys.stderr)


def _rescue_within_window(text: str, start: int, window: int = 120) -> bool:
    end = min(len(text), start + window)
    chunk = text[start:end]
    for pat in RESCUE_RES:
        if pat.search(chunk):
            return True
    return False


def _rescue_backward(text: str, start: int, window: int = 80) -> bool:
    """Rescue when fix-language appears within `window` chars BEFORE the
    escape phrase ("Fixed pre-existing X" -- past-tense report)."""
    begin = max(0, start - window)
    chunk = text[begin:start]
    for pat in RESCUE_BACKWARD_RES:
        if pat.search(chunk):
            return True
    return False


def _rescue_b_clause(text: str, start: int, window: int = 320) -> bool:
    """Delegate to the shared (b)-clause recognizer. Kept as a thin
    wrapper so callers in this file have a single name to use."""
    return b_clause_within_window(text, start, window)


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

    # Strip code fences / quoted spans so doc/example mentions don't
    # false-fire. Same discipline as exhaust_check.
    stripped = re.sub(r"```.*?```", " ", raw_text, flags=re.DOTALL)
    stripped = re.sub(r"`[^`\n]*`", " ", stripped)
    stripped = re.sub(r'"[^"\n]*"', " ", stripped)
    stripped = re.sub(r"'[^'\n]*'", " ", stripped)
    text = stripped
    text_l = text.lower()

    # Substring scan over SCOPE_ESCAPE phrase list.
    matched_phrase = None
    matched_pos = -1
    for phrase in SCOPE_ESCAPE:
        idx = text_l.find(phrase)
        if idx == -1:
            continue
        if matched_pos == -1 or idx < matched_pos:
            matched_phrase = phrase
            matched_pos = idx

    if matched_phrase is None:
        _emit_stats("ok", "no_escape_phrase")
        print("ok")
        return 0

    # Rescue clause (forward): agent said they fixed it within 120 chars.
    # Trust it (fabrication_check will catch the lie if it's a lie).
    if _rescue_within_window(text, matched_pos):
        _emit_stats("ok", f"rescue_clause phrase={matched_phrase!r} pos={matched_pos}")
        print("ok")
        return 0

    # Rescue (backward): "Fixed X" appeared just BEFORE the escape phrase
    # (past-tense form: "Fixed pre-existing missing import in foo").
    if _rescue_backward(text, matched_pos):
        _emit_stats("ok", f"rescue_backward phrase={matched_phrase!r} pos={matched_pos}")
        print("ok")
        return 0

    # Rescue (b)-clause: the deny message explicitly sanctions
    # "say so explicitly and explain why fixing is the wrong move".
    # When the agent does exactly that, the detector must NOT fire --
    # otherwise the "valid alternative" the rule offers doesn't exist.
    # Without this, every legitimate refusal-with-reason gets flagged
    # the same as a lazy punt, and the agent learns to never refuse
    # even when refusal is correct.
    if _rescue_b_clause(text, matched_pos):
        _emit_stats("ok", f"rescue_b_clause phrase={matched_phrase!r} pos={matched_pos}")
        print("ok")
        return 0

    text_len = len(text)
    in_closing = text_len > 200 and (
        matched_pos >= int(text_len * 0.60)
        or (text_len - matched_pos) <= 400
    )
    after = text[matched_pos:]
    handoff_count = sum(1 for _ in _ANY_HANDOFF_MARKER.finditer(after))

    if in_closing or handoff_count >= 1:
        reason = (
            f"phrase={matched_phrase!r} in_closing={in_closing} "
            f"handoff_markers={handoff_count} pos={matched_pos}/{text_len}"
        )
        _emit_stats("scope_escape_violation", reason)
        print("scope_escape_violation")
        return 0

    _emit_stats("ok", f"phrase={matched_phrase!r} but mid-text and no handoff markers")
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
