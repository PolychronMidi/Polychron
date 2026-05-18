#!/usr/bin/env python3
<<<<<<< Updated upstream
"""Retired advisor-doctrine detector.
=======
"""Legacy advisor-call detector.
>>>>>>> Stashed changes

Historical PAI v6.3.0 doctrine: on Extended+ effort (E2+) tasks, the
advisor had to leave a record at:
  (1) before committing to an approach (after PLAN, before BUILD)
  (2) when stuck or diverging (after two failed attempts)
  (3) once after a durable deliverable (before phase: complete)

The legacy advisor toolchain has been removed. In live sessions this detector
returns ok when the legacy advisor CLI is absent, while keeping the historical
fixture path available through ADVISOR_DOCTRINE_TIER overrides.

Rule 3 hard cap: max 2 re-calls of the advisor on the SAME conflict. The
third re-call is a violation -- escalate to the user instead.

This detector fires post-turn. Inputs:
  - tier (from mode-classifier.jsonl most-recent line, or override env)
  - tool_use list this turn (legacy advisor Bash invocations)
  - the assistant's closing summary (looks for commitment markers)
  - tmp/hme-advisor-conflicts.jsonl (project-local advisor history;
    enables Rule 3 cap detection across turns)

Verdicts:
  ok                              tier < E2 OR all required calls present
  advisor_missing_pre_build       phase signal "BUILD" without prior advisor record
  advisor_missing_post_deliver    phase signal "complete" without final advisor record
  advisor_conflict_cap_exceeded   third re-call on same conflict
  advisor_silently_skipped        E4/E5 turn with no advisor call AND no
                                  rescue clause justifying solo

Rescue: "solo was right" / "no decision to crystallize" / "(b)-clause"
language in assistant text suppresses the gate.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transcript import (  # noqa: E402
    _parse_all, event_content, is_user, iter_tool_uses,
)

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parent.parent.parent.parent)
_METRICS_DIR = Path(os.environ.get("HME_METRICS_DIR") or (_PROJECT / "tools" / "HME" / "runtime" / "metrics"))
_MODE_LOG = _METRICS_DIR / "mode-classifier.jsonl"
_ADVISOR_LOG = _PROJECT / "tmp" / "hme-advisor-conflicts.jsonl"

# Phase markers in assistant text (PAI emits these; Polychron may emit a
_PRE_BUILD_RE = re.compile(
    r"={3,}\s*BUILD\s*={3,}|^\s*phase:\s*build\b|"
    r"\b(committing to (the )?approach|going with this approach)\b",
    re.IGNORECASE | re.MULTILINE,
)
_POST_DELIVER_RE = re.compile(
    r"={3,}\s*LEARN\s*={3,}|^\s*phase:\s*complete\b|"
    r"\bbefore (setting|marking) phase: complete\b|"
    r"\bdurable deliverable\b",
    re.IGNORECASE | re.MULTILINE,
)
_ADVISOR_INVOKE_RE = re.compile(r"\bAdvisor\b\s*\(", re.IGNORECASE)

# Solo-rationale rescue.
_SOLO_RES = (
    re.compile(r"\bsolo\s+(was|is)\s+(the\s+)?right\b", re.IGNORECASE),
    re.compile(r"\bno\s+decision\s+to\s+crystallize\b", re.IGNORECASE),
    re.compile(r"\bmechanical\s+(rename|edit|change)\b", re.IGNORECASE),
)

DECLARED_VERDICTS = {
    "ok",
    "advisor_missing_pre_build",
    "advisor_missing_post_deliver",
    "advisor_silently_skipped",
}


<<<<<<< Updated upstream
def _legacy_advisor_available() -> bool:
    return False
=======
def _legacy_consult_available() -> bool:
    return (_PROJECT / "i" / "consult").is_file()
>>>>>>> Stashed changes


def _last_assistant_text(events: list) -> str:
    last = None
    for ev in events:
        if (ev.get("type") == "assistant"
                or (ev.get("role") == "assistant" and ev.get("content"))):
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


def _read_tier() -> str | None:
    """Most-recent tier from mode-classifier.jsonl. Returns None when no fresh entry exists -- stale fixtures from prior corpus runs must not drive live gating."""
    if os.environ.get("ADVISOR_DOCTRINE_TIER"):
        return os.environ["ADVISOR_DOCTRINE_TIER"]
    if not _MODE_LOG.is_file():
        return None
    try:
        last = None
        with open(_MODE_LOG, encoding="utf-8") as f:
            for line in f:
                try:
                    last = json.loads(line)
                except json.JSONDecodeError:
                    continue
        if not last:
            return None
        ts = last.get("ts")
        max_age = float(os.environ.get("ADVISOR_DOCTRINE_TIER_MAX_AGE_SECS", "3600"))
        if isinstance(ts, (int, float)) and (time.time() - ts) > max_age:
            return None
        return last.get("tier")
    except OSError:
        return None


def _solo_rescue(text: str) -> bool:
    return any(pat.search(text) for pat in _SOLO_RES)


<<<<<<< Updated upstream
def _advisor_invocations(events: list) -> int:
=======
def _consult_invocations(events: list) -> int:
>>>>>>> Stashed changes
    """Count this turn's legacy advisor Bash invocations."""
    count = 0
    for ev in events:
        for tu in iter_tool_uses(ev):
            if tu["name"] != "Bash":
                continue
            cmd = tu["input"].get("command", "") or ""
            if _ADVISOR_INVOKE_RE.search(cmd):
                count += 1
    return count


# Tool calls that count as direct work for the implicit-solo rescue.
# Edit/Write/MultiEdit/NotebookEdit are unambiguous code changes.
_WORK_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}

_BASH_WORK_RE = re.compile(
    r"\b(?:sed\s|awk\s|perl\s+-i|python3?\s+-c\b.*?\bopen\s*\(|"
    r"git\s+(?:apply|commit|merge|rebase|cherry-pick)|"
    r"\bmv\s|\bcp\s|\brm\s|\btee\s|>\s*\S|>>\s*\S)",
    re.IGNORECASE | re.DOTALL,
)


def _substantive_work_count(events: list) -> int:
    """Count code-changing tool calls in this turn. Edit/Write tools count
    directly; Bash counts when the command shape modifies files (sed,
    python -c with file write, git mutating ops, redirections). Read /
    plain Bash investigation / Glob don't count. Threshold downstream
    is >= 3 for implicit-solo rescue."""
    n = 0
    for ev in events:
        for tu in iter_tool_uses(ev):
            name = tu.get("name", "")
            if name in _WORK_TOOLS:
                n += 1
                continue
            if name == "Bash":
                cmd = tu.get("input", {}).get("command", "") or ""
                if _BASH_WORK_RE.search(cmd):
                    n += 1
    return n


def _conflict_cap_exceeded() -> bool:
    """Read tmp/hme-advisor-conflicts.jsonl for any conflict_id with
    re-call count >= 3 (violates Rule 3's max-2 cap). Best-effort: the
    log file may not exist yet."""
    if not _ADVISOR_LOG.is_file():
        return False
    try:
        from collections import defaultdict
        recalls: dict = defaultdict(int)
        with open(_ADVISOR_LOG, encoding="utf-8") as f:
            for line in f:
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if e.get("kind") == "recall":
                    recalls[e.get("conflict_id", "?")] += 1
        return any(v >= 3 for v in recalls.values())
    except OSError:
        return False


def _load_current_turn(transcript_path: str) -> list[dict]:
    """Slice from the last REAL user prompt onward so tool_result wrapper
    events don't lose the advisor tool_use that preceded them."""
    events = _parse_all(transcript_path)
    last_real_user_idx = -1
    for i, ev in enumerate(events):
        if not is_user(ev):
            continue
        msg = ev.get("message")
        content = msg.get("content") if isinstance(msg, dict) else ev.get("content")
        if isinstance(content, str):
            last_real_user_idx = i
    if last_real_user_idx == -1:
        return events
    return events[last_real_user_idx:]


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0

    tier = _read_tier()
    if tier in (None, "MINIMAL", "NATIVE", "E1"):
        # Doctrine only fires at E2+.
        print("ok")
        return 0
<<<<<<< Updated upstream
    if not os.environ.get("ADVISOR_DOCTRINE_TIER") and not _legacy_advisor_available():
=======
    if not os.environ.get("ADVISOR_DOCTRINE_TIER") and not _legacy_consult_available():
>>>>>>> Stashed changes
        print("ok")
        return 0

    events = _load_current_turn(sys.argv[1])
    text = _last_assistant_text(events)
    n_advisor_records = _advisor_invocations(events)
    n_work = _substantive_work_count(events)
    text_lower = text.lower()

    # Implicit-solo rescue: >=3 code-changing tool calls means execution.
    implicit_solo = n_work >= 3

    # Rule 3 cap -- historic violation across turns.
    if _conflict_cap_exceeded():
        print("advisor_conflict_cap_exceeded")
        return 0

    # Rule 2 (1): pre-BUILD commitment required an advisor record.
    if _PRE_BUILD_RE.search(text) and n_advisor_records == 0:
        if not _solo_rescue(text) and not implicit_solo:
            print("advisor_missing_pre_build")
            return 0

    # Rule 2 (3): post-durable-deliverable advisor record before phase: complete.
    if _POST_DELIVER_RE.search(text) and n_advisor_records == 0:
        if not _solo_rescue(text) and not implicit_solo:
            print("advisor_missing_post_deliver")
            return 0

    # E4/E5 floor: silently skipping advisor on Deep/Comprehensive work
    # warrants a flag even when no explicit phase markers fired.
    if (tier in ("E4", "E5") and n_advisor_records == 0
            and not _solo_rescue(text) and not implicit_solo):
        print("advisor_silently_skipped")
        return 0

    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
