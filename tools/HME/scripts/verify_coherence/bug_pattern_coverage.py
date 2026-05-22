"""Bug-pattern coverage invariant.

Closes the scar-tissue -> immune-system loop. Walks the last N fix-shape
git commits, extracts candidate concern tokens from each subject (lower-
case alphanumeric words 4+ chars, excluding generic stopwords), and
checks whether any verifier in REGISTRY has a name/category/subtag/
module mentioning the token. Concern tokens with no covering verifier
surface as WARN -- the actionable read is "this commit class has been
fixed but no regression guard exists for it."

A sidecar exemption file (tools/HME/config/bug_pattern_waivers.json)
declares concern tokens that are intentionally unwatched (e.g. one-off
typos, vendored-dep bumps). Stale waivers fail the same way as the
verifier-self-coverage waiver list.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from ._base import (
    Verifier,
    _PROJECT,
    failed,
    passed,
    register,
    skipped,
    warned,
)

FIX_KEYWORDS = ("fix", "bug", "regression", "repair", "patch", "correct")
WAIVERS_REL = "tools/HME/config/bug_pattern_waivers.json"
LOG_LIMIT = 100

_TOKEN_RE = re.compile(r"[a-z][a-z0-9_]{3,}")
_STOPWORDS = frozenset({
    "fix", "fixes", "fixed", "bug", "bugs", "regression", "repair", "patch",
    "from", "into", "with", "when", "then", "that", "this", "those", "these",
    "after", "before", "around", "again", "also", "just", "only", "more",
    "less", "make", "made", "have", "been", "being", "where", "which", "what",
    "their", "there", "them", "than", "such", "still", "even", "during",
    "for_the", "the", "and", "but", "the_", "should", "would", "could", "will",
    "claude", "code", "hme", "proxy", "tools", "config", "test", "tests",
    "spec", "specs", "file", "files", "line", "lines", "case", "cases",
    "self", "this_", "verifier", "verifiers", "module", "modules",
    "function", "functions", "method", "methods", "class", "classes",
    "method_", "name", "names", "value", "values",
})


def _git_log_subjects(root: Path, limit: int) -> list[tuple[str, str]]:
    try:
        rc = subprocess.run(
            ["git", "-C", str(root), "log", f"-{limit}",
             "--pretty=format:%h%x09%s"],
            capture_output=True, text=True, timeout=10, check=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired,
            FileNotFoundError, OSError):
        return []
    out: list[tuple[str, str]] = []
    for line in rc.stdout.splitlines():
        if "\t" not in line:
            continue
        sha, subject = line.split("\t", 1)
        out.append((sha, subject))
    return out


def _is_fix_subject(subject: str) -> bool:
    lower = subject.lower()
    return any(kw in lower for kw in FIX_KEYWORDS)


def _concern_tokens(subject: str) -> set[str]:
    text = subject.lower()
    tokens = _TOKEN_RE.findall(text)
    return {t for t in tokens if t not in _STOPWORDS}


def _registry_index() -> set[str]:
    """Collect lowercase identifier-shaped tokens from every verifier's
    name/category/subtag/module. A bug-pattern concern is considered
    covered if it appears as a substring of any of these tokens."""
    from . import REGISTRY
    tokens: set[str] = set()
    for v in REGISTRY:
        for attr in ("name", "category", "subtag"):
            val = getattr(v, attr, "") or ""
            if isinstance(val, str):
                tokens.update(_TOKEN_RE.findall(val.lower().replace("-", "_")))
        mod = getattr(v.__class__, "__module__", "") or ""
        tokens.update(_TOKEN_RE.findall(mod.lower()))
    return tokens


def _is_covered(concern: str, index: set[str]) -> bool:
    if concern in index:
        return True
    for tok in index:
        if concern in tok or tok in concern:
            return True
    return False


def _load_waivers(root: Path) -> set[str]:
    p = root / WAIVERS_REL
    if not p.is_file():
        return set()
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    waivers = data.get("waivers") or []
    out: set[str] = set()
    for w in waivers:
        if isinstance(w, dict) and isinstance(w.get("concern"), str):
            out.add(w["concern"].lower())
    return out


@register
class BugPatternCoverageVerifier(Verifier):
    """Every recurring fix-commit concern should have a verifier that mentions it."""

    name = "bug-pattern-coverage"
    category = "code"
    subtag = "regression-prevention"
    weight = 1.0

    def run(self):
        root = Path(_PROJECT)
        subjects = _git_log_subjects(root, LOG_LIMIT)
        if not subjects:
            return skipped(summary="git log empty or unreachable")

        index = _registry_index()
        waivered = _load_waivers(root)

        concern_occurrences: dict[str, list[str]] = {}
        for sha, subject in subjects:
            if not _is_fix_subject(subject):
                continue
            for concern in _concern_tokens(subject):
                concern_occurrences.setdefault(concern, []).append(f"{sha} {subject[:60]}")

        if not concern_occurrences:
            return passed(summary=f"no fix-shape commits in last {LOG_LIMIT}")

        uncovered: list[str] = []
        stale_waivers: list[str] = []
        covered_count = 0
        observed_concerns = set(concern_occurrences.keys())
        for concern, occurrences in sorted(concern_occurrences.items()):
            if _is_covered(concern, index):
                covered_count += 1
                continue
            if concern in waivered:
                continue
            uncovered.append(
                f"{concern}: appeared in {len(occurrences)} fix commit(s) "
                f"but no verifier name/category/subtag matches "
                f"(e.g. {occurrences[0]})"
            )

        for w in sorted(waivered - observed_concerns):
            stale_waivers.append(
                f"stale waiver: '{w}' no longer appears in recent fix commits; "
                f"remove from {WAIVERS_REL}"
            )

        if stale_waivers:
            return failed(
                summary=f"{len(stale_waivers)} stale bug-pattern waiver(s)",
                details=stale_waivers,
            )

        if not uncovered:
            return passed(
                summary=f"all {covered_count} recent bug-pattern concern(s) are covered",
            )
        score = max(0.0, 1.0 - len(uncovered) / 20.0)
        return warned(
            summary=f"{len(uncovered)}/{covered_count + len(uncovered)} "
            "fix-commit concern(s) lack a verifier",
            score=score,
            details=uncovered[:30],
        )
