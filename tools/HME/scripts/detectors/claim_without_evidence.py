#!/usr/bin/env python3
"""Detect "completion claim without same-turn evidence" antipattern.

Pattern absorbed from polychron-references/superpowers-main:
verification-before-completion's Iron Law -- "NO COMPLETION CLAIMS
WITHOUT FRESH VERIFICATION EVIDENCE. If you haven't run the verification
command in this message, you cannot claim it passes."

Trigger: assistant's FINAL text contains a completion-claim phrase
(e.g. "tests pass", "live at git_sha X", "all 12 fire", "fix lands")
AND no evidence-producing tool call appears in the same assistant turn.

Evidence-producing tool calls:
  - Bash with verification command (test, curl /health, node -c, python -c,
    grep, stat, ls, jq, find, lint, build)
  - Read of a file that the claim references (covers "the file now reads X")
  - Tool_result with PASS/FAIL/exit-code shape

Conservative regexes -- catches the common claim shapes without firing
on legitimate prose ("the code that lands here", "the file we work on",
"this passes through middleware").

Verdict: "claim_without_evidence" or "ok".
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import (  # noqa: E402
    is_assistant, event_content, load_turn_events,
    load_full_turn_with_user, iter_tool_uses,
)


# Phrases that signal a completion claim. Anchored tightly to "subject +
# success-verb" or "result-noun + state" shapes so legitimate uses of
# the verbs in other contexts ("the code that lands here") don't fire.
_CLAIM_PATTERNS = (
    # "tests pass", "build passes", "lint clean", "tests fire", etc.
    re.compile(r"\b(tests?|build|lint|fix|patch|migration|verifier|check|"
               r"audit|the\s+(?:code|change|edit|fix|patch|update))\s+"
               r"(passe?s?|works|succeeds?|lands?|fires?|landed|shipped|"
               r"clean|verified|complete|done)\b", re.IGNORECASE),
    # "X out of Y pass/fire" -- the all-pass roll-up shape.
    re.compile(r"\b\d+\s*/\s*\d+\b[^.\n]{0,30}\b(passe?s?|fires?|works|"
               r"clean|land|landed|verified)\b", re.IGNORECASE),
    re.compile(r"\ball\s+\d+\b[^.\n]{0,20}\b(passe?s?|fires?|land|landed|"
               r"works|verified|clean)\b", re.IGNORECASE),
    # "Live at git_sha X" / "Live in proxy <pid>" / "Now live" -- the
    # restart-confirms-deploy shape. Even more dangerous because the
    # health probe IS evidence; the claim should cite it.
    re.compile(r"\bLive\s+(at|in|on)\s+\S+", re.IGNORECASE),
    # "now (works|fires|lands|live|fixed|verified)" -- present-tense
    # state-change claim.
    re.compile(r"\bnow\s+(works|passes|fires|live|fixed|verified|clean|"
               r"resolves?|recovers?)\b", re.IGNORECASE),
    # Bare standalone declarations.
    re.compile(r"\b(?:it|that|this)\s+(?:now\s+)?(works|passes|fires|"
               r"lands|landed|shipped|verified|fixed)\b", re.IGNORECASE),
)

# Verification-shape Bash tokens. Excludes informational `git status`.
_EVIDENCE_BASH_TOKENS = (
    "test", "tests", "pytest", "jest", "mocha", "vitest", "go test",
    "cargo test", "npm test", "yarn test", "make test",
    "node -c", "node --check", "python -c", "python3 -c",
    "tsc --noemit", "tsc --noEmit", "eslint", "ruff",
    "build", "make", "cargo build", "npm run build", "yarn build",
    "curl", "wget", "http",
    "verify-coherence", "verify-doc-sync", "audit-",
    "polychron-proxy-restart", "polychron-restart",
    "/health", "i/why", "i/status",
    "wc -l", "stat", "diff",
    "node -e",  # inline JS test runner -- used for unit testing rewriters
)

_PROBE_TOOL_NAMES = {"Bash", "Read", "Grep", "Glob", "WebFetch", "TaskOutput"}

DECLARED_VERDICTS = {"ok", "claim_without_evidence"}


def _last_assistant_event(events: list) -> dict | None:
    last = None
    for ev in events:
        if is_assistant(ev):
            last = ev
    return last


def _last_assistant_text(events: list) -> str:
    ev = _last_assistant_event(events)
    if not ev:
        return ""
    parts = []
    for block in event_content(ev):
        if isinstance(block, dict) and block.get("type") == "text":
            t = block.get("text", "")
            if isinstance(t, str):
                parts.append(t)
        elif isinstance(block, str):
            parts.append(block)
    return "\n".join(parts)


def _strip_quoted_regions(text: str) -> str:
    """Remove backtick-fenced spans before claim-pattern matching.

    Mirrors phantom_capability's policy: literal-quoted text inside
    backticks is the agent quoting source material, not making a claim.
    Triple-backtick code fences and single backticks both stripped.
    """
    # Strip triple-backtick blocks first.
    out = re.sub(r"```[\s\S]*?```", " ", text)
    # Then single-backtick spans.
    out = re.sub(r"`[^`\n]*`", " ", out)
    return out


def _find_claim(text: str) -> tuple[str, str] | None:
    """Return (pattern_label, matched_text) of the first claim phrase
    detected in the agent's prose, or None. Strips backtick-quoted
    spans before matching."""
    body = _strip_quoted_regions(text)
    for i, pat in enumerate(_CLAIM_PATTERNS):
        m = pat.search(body)
        if m:
            return (f"pattern[{i}]", m.group(0))
    return None


def _collect_assistant_tool_uses_in_turn(events: list) -> list[dict]:
    """Walk EVERY assistant event in the current turn (since the last
    triggering user message) and collect tool_uses from each. Required
    because Claude Code's transcript splits a single agent turn into
    multiple assistant events when tool_use / tool_result rounds are
    interleaved with text -- the last assistant event (which carries
    the final text) often has no tool_uses even though earlier
    assistant events in the same turn ran the verification probes.
    Looking only at the last event misses all prior tool_uses and
    false-positive-fires the claim_without_evidence gate."""
    out = []
    for ev in events:
        if not is_assistant(ev):
            continue
        for tu in iter_tool_uses(ev):
            out.append(tu)
    return out


def _had_evidence(tool_uses: list[dict]) -> bool:
    """True if any tool_use looks like a verification probe."""
    for tu in tool_uses:
        name = tu.get("name", "")
        # Read / Grep / Glob / WebFetch / TaskOutput are inspection-shape
        # by default -- they READ state, which is evidence-producing.
        if name in {"Read", "Grep", "Glob", "WebFetch", "TaskOutput"}:
            return True
        if name == "Bash":
            cmd = ""
            inp = tu.get("input", {}) or {}
            if isinstance(inp, dict):
                cmd = str(inp.get("command", ""))
            elif isinstance(inp, str):
                cmd = inp
            cmd_l = cmd.lower()
            for tok in _EVIDENCE_BASH_TOKENS:
                if tok in cmd_l:
                    return True
    return False


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    # Full-turn loader: tool_uses in earlier assistant events of the
    # same turn count as evidence (multi-event turn handling).
    events = load_full_turn_with_user(sys.argv[1])
    if not events:
        print("ok")
        return 0
    last = _last_assistant_event(events)
    if not last:
        print("ok")
        return 0

    # The whole point: text claims completion BUT same-TURN tool_uses
    # contain no evidence probe. If there's no claim, fine. If there IS
    # a claim but ALSO evidence in the same turn, fine. Only the
    # claim-without-evidence shape fires.
    text = _last_assistant_text(events)
    claim = _find_claim(text)
    if claim is None:
        print("ok")
        return 0

    tool_uses = _collect_assistant_tool_uses_in_turn(events)
    if _had_evidence(tool_uses):
        print("ok")
        return 0

    print("claim_without_evidence")
    return 0


if __name__ == "__main__":
    sys.exit(main())
