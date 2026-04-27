"""Quote/code-fence stripping for phrase-matching detectors.

Centralizes the discipline that stop_work + failfast + exhaust_check
already apply: strip quoted/backticked/fenced spans before phrase-
matching so a response that DESCRIBES a pattern (regex example,
quoted user prompt, code block showing the antipattern) doesn't
false-fire as if the agent declared/wrote the pattern.

Caught failure mode (April 2026 stress test):
  - Agent writes: 'matches no-op shapes: `^(All done|...)$`'
  - stop_work without strip: matches 'all done' → DISMISSIVE
  - With strip: backticked span removed → no match → ok

Apply via `strip_quoted(text)` before any phrase / regex check that
isn't intentionally matching code/quoted content.
"""
from __future__ import annotations
import re

_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_BACKTICK_RE = re.compile(r"`[^`\n]*`")
_DOUBLE_QUOTED_RE = re.compile(r'"[^"\n]*"')
_SINGLE_QUOTED_RE = re.compile(r"'[^'\n]*'")


def strip_quoted(text: str) -> str:
    """Return text with code-fenced / backticked / quoted spans
    replaced by single spaces (preserves byte positions roughly while
    eliminating false-match content)."""
    if not text:
        return text
    s = _FENCE_RE.sub(" ", text)
    s = _INLINE_BACKTICK_RE.sub(" ", s)
    s = _DOUBLE_QUOTED_RE.sub(" ", s)
    s = _SINGLE_QUOTED_RE.sub(" ", s)
    return s
