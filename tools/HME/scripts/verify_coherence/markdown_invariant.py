"""Markdown invariant verifier.

Project-wide rule: the only allowed .md files are
  1. doc/composition.md
  2. doc/composition-full.md
  3. doc/self-coherence.md
  4. doc/self-coherence-full.md
  5. README.md files that serve as concise directory-intent notes
     (<= MAX_README_LINES non-blank lines and <= MAX_README_BYTES bytes)

Anything else is a violation. Vendored trees and ephemeral state dirs
(node_modules, tools/models, tools/smolagents, tools/omniroute, .git,
.venv, .pytest_cache, log, tmp, runtime, __pycache__) are skipped so
upstream documentation does not register as repo policy.

Concise readme defaults are intentionally permissive: 120 non-blank
lines and 8 KiB on disk. Raising the limit is a policy change, not a
per-readme escape hatch.

Companion rule (dir_intent coverage): every directory in the repo
that holds tracked or non-ignored content -- excluding the doc/
subtree and anything matching the SKIP_DIRS set / .gitignore -- must
ship a README.md. The README is the directory's stated intent; an
unexplained directory is treated as drift.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

from ._base import (
    FAIL,
    PASS,
    VerdictResult,
    Verifier,
    WARN,
    _PROJECT,
    _result,
    passed,
    register,
    skipped,
)

ALLOWED_FILENAMES = {
    "composition.md": "doc/composition.md",
    "composition-full.md": "doc/composition-full.md",
    "self-coherence.md": "doc/self-coherence.md",
    "self-coherence-full.md": "doc/self-coherence-full.md",
}

# Long-form essays + canonical templates live in declared SUBTREES, not a
# blanket doc/ grandfather. The doc/ TOP LEVEL is reserved for the four canonical
# specs (ALLOWED_FILENAMES); a new top-level doc/*.md is a subversion (e.g. a
ALLOWED_PREFIXES = (
    "doc/theory/",
    "doc/templates/",
    "tools/csv_maestro/doc/",
    "tools/HME/tests/fixtures/",
    # Durable team-review feature infra (moved out of throwaway tmp/): Context
    # Capsules are tracked, first-class review inputs (artifact+goal+rubric+
    "teams/capsules/",
)

# doc/templates/ holds the canonical TODO tracker (todo-code grammar) + prompt
# templates, so the spillover content-scan must NOT fire there. Everywhere else
SPILLOVER_SCAN_EXEMPT_PREFIXES = ("doc/templates/",)
_TODO_CODE_RE = re.compile(r"^\s*#\d+\s+(?:0|1|2|3|4f|4|5)_(?:\d+)?(?:\s|$)")
_STATUS_ROW_RE = re.compile(
    r"^\s*\|.*\|\s*(reviewed|pending|partial|done|blocked|wip|todo|in[ -]progress)\s*\|\s*$",
    re.IGNORECASE,
)


def doc_spillover_reason(rel_str: str, text: str) -> str:
    """Return a reason if a doc .md is actually machine-data / TODO-tracking
    spillover (not prose), else "". Catches the subversion of hiding tracking or
    a parsed data table under doc/ to dodge the limited-.md-files invariant."""
    if not rel_str.startswith("doc/"):
        return ""
    if any(rel_str.startswith(p) for p in SPILLOVER_SCAN_EXEMPT_PREFIXES):
        return ""
    todo_lines = [ln for ln in text.splitlines() if _TODO_CODE_RE.match(ln)]
    if todo_lines:
        return f"{rel_str} -- carries TODO-tracking grammar ({len(todo_lines)} todo line(s)); tracking belongs in doc/templates/TODO.md, not a doc"
    status_rows = [ln for ln in text.splitlines() if _STATUS_ROW_RE.match(ln)]
    if len(status_rows) >= 2:
        return f"{rel_str} -- carries a {len(status_rows)}-row status-tracking table; machine-readable status belongs in a data file (.json/.py) beside its consumer, not a doc"
    return ""

# Single-file exceptions at otherwise non-prefixed locations.
ALLOWED_PATHS = {
    "plan.md",
}

TEAM_CHANNEL_DIR = Path("teams")

SKIP_DIRS = {
    ".git",
    ".venv",
    "venv",
    ".pytest_cache",
    "__pycache__",
    "node_modules",
    "log",
    "tmp",
    "runtime",
    "lab",
    "models",
    "smolagents",
    "opencode",
    "oh-my-openagent",
    "omniroute",
    "plugin-cache",
    ".claude",
    "KB",
    "dist",
    "build",
    "output",
}

MAX_README_LINES = 120
MAX_README_BYTES = 8 * 1024

# Dirs exempt from the dir_intent README requirement. doc/ holds long-form
# essays + canonical specs (which document themselves); the SKIP_DIRS set
README_EXEMPT_PREFIXES = ("doc",)

# Specific subtrees exempt from the dir_intent README requirement. These
# are generated or registry-managed dirs whose contents are constrained by
README_EXEMPT_PATHS = (
    "tools/HME/i",
)


def _is_skipped(parts: tuple[str, ...]) -> bool:
    return any(p in SKIP_DIRS for p in parts)


def _is_readme_exempt(rel_dir: Path) -> bool:
    if rel_dir == Path("."):
        return False
    parts = rel_dir.parts
    if parts[0] in README_EXEMPT_PREFIXES:
        return True
    if any(p in SKIP_DIRS for p in parts):
        return True
    if any(p.startswith(".") for p in parts):
        return True
    rel_str = str(rel_dir).replace(os.sep, "/")
    if any(rel_str == p or rel_str.startswith(p + "/") for p in README_EXEMPT_PATHS):
        return True
    return False


def _list_dirs_for_readme_check(root: Path) -> set[Path]:
    """Return relative dirs under ``root`` that owe a dir_intent README.

    Prefers ``git ls-files`` so .gitignore is respected exactly the way
    git sees it. Falls back to an os.walk that honors SKIP_DIRS when
    git is unavailable (e.g. inside a unit-test tempdir).
    """
    files: list[Path] = []
    try:
        rc = subprocess.run(
            ["git", "-C", str(root), "ls-files", "--cached", "--others",
             "--exclude-standard"],
            capture_output=True, text=True, timeout=30, check=True,
        )
        for line in rc.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            files.append(Path(line))
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired,
            FileNotFoundError, OSError):
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [
                d for d in dirnames
                if d not in SKIP_DIRS and not d.startswith(".")
            ]
            for fn in filenames:
                try:
                    rel = (Path(dirpath) / fn).relative_to(root)
                except ValueError:
                    continue
                files.append(rel)

    dirs: set[Path] = {Path(".")}
    for f in files:
        for parent in f.parents:
            if parent == Path("."):
                continue
            dirs.add(parent)
    return dirs


def _walk_markdown(root: str):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if not fn.endswith(".md"):
                continue
            yield Path(dirpath) / fn


def _classify(rel_path: Path) -> tuple[str, str]:
    name = rel_path.name
    rel_str = str(rel_path).replace(os.sep, "/")
    if rel_str in ALLOWED_PATHS:
        return "allowed_canonical", ""
    if rel_path.parent == TEAM_CHANNEL_DIR and name in {"driver.md", "red.md", "blue.md", "purple.md"}:
        return "allowed_team_channel", ""
    if any(rel_str.startswith(prefix) for prefix in ALLOWED_PREFIXES):
        return "allowed_prefix", ""
    if name in ALLOWED_FILENAMES:
        canonical = ALLOWED_FILENAMES[name]
        if rel_str == canonical:
            return "allowed_canonical", ""
        return "misplaced_canonical", f"{rel_str} must live at {canonical}"
    if name == "README.md":
        return "readme", ""
    return "disallowed", (
        f"{rel_str} -- only README.md (concise), files under "
        f"{', '.join(ALLOWED_PREFIXES)}, and "
        "doc/{composition,composition-full,self-coherence,self-coherence-full}.md "
        "are allowed"
    )


_AUTO_BLOCK_RE = re.compile(
    r"<!--\s*BEGIN_[A-Z0-9_]+\s*-->.*?<!--\s*END_[A-Z0-9_]+\s*-->\s*",
    re.DOTALL,
)


def _readme_size(abs_path: Path) -> tuple[int, int]:
    try:
        raw = abs_path.read_bytes()
    except OSError:
        return 0, 0
    text = raw.decode("utf-8", errors="ignore")
    text = _AUTO_BLOCK_RE.sub("", text)
    raw = text.encode("utf-8")
    non_blank = sum(1 for line in text.splitlines() if line.strip())
    return non_blank, len(raw)


@register
class MarkdownInvariantVerifier(Verifier):
    """Enforce the project-wide .md whitelist + concise-readme rule."""

    name = "markdown-invariant"
    category = "doc"
    subtag = "structural-integrity"
    weight = 1.5

    def run(self) -> VerdictResult:
        root = Path(_PROJECT)
        violations: list[str] = []
        readme_overruns: list[str] = []
        misplaced: list[str] = []
        readmes_seen: set[Path] = set()
        allowed_count = 0
        readme_count = 0
        for abs_path in _walk_markdown(str(root)):
            try:
                rel_path = abs_path.relative_to(root)
            except ValueError:
                continue
            kind, detail = _classify(rel_path)
            rel_str = str(rel_path).replace(os.sep, "/")
            if kind in ("allowed_canonical", "allowed_prefix") and rel_str.startswith("doc/"):
                try:
                    spill = doc_spillover_reason(rel_str, abs_path.read_text(encoding="utf-8", errors="ignore"))
                except OSError:
                    spill = ""  # silent-ok: unreadable doc => no content signal; path-rule already classified it
                if spill:
                    violations.append(spill)
                    continue
            if kind == "allowed_canonical":
                allowed_count += 1
                continue
            if kind == "allowed_prefix":
                allowed_count += 1
                continue
            if kind == "allowed_team_channel":
                allowed_count += 1
                continue
            if kind == "misplaced_canonical":
                misplaced.append(detail)
                continue
            if kind == "readme":
                readmes_seen.add(rel_path.parent)
                non_blank, size = _readme_size(abs_path)
                if non_blank > MAX_README_LINES or size > MAX_README_BYTES:
                    readme_overruns.append(
                        f"{rel_path} -- {non_blank} non-blank lines / {size} bytes "
                        f"(limit {MAX_README_LINES} lines / {MAX_README_BYTES} bytes)"
                    )
                else:
                    readme_count += 1
                continue
            violations.append(detail)

        missing_readmes: list[str] = []
        dirs_needing_readme = _list_dirs_for_readme_check(root)
        for d in sorted(dirs_needing_readme, key=lambda p: str(p)):
            if _is_readme_exempt(d):
                continue
            if d in readmes_seen:
                continue
            if (root / d / "README.md").is_file():
                continue
            display = "." if d == Path(".") else str(d).replace(os.sep, "/")
            missing_readmes.append(f"{display}/ -- missing dir_intent README.md")

        all_issues = violations + misplaced + readme_overruns + missing_readmes
        if not all_issues:
            return passed(score=1.0, summary=f"{allowed_count}/4 canonical docs present, "
                f"{readme_count} concise README(s); no other .md files")

        score = max(0.0, 1.0 - len(all_issues) / 20.0)
        status = FAIL if violations else WARN
        summary = (
            f"{len(violations)} disallowed .md file(s)"
            + (f", {len(misplaced)} misplaced canonical(s)" if misplaced else "")
            + (f", {len(readme_overruns)} oversized README(s)" if readme_overruns else "")
            + (f", {len(missing_readmes)} dir(s) missing README" if missing_readmes else "")
        )
        details = all_issues[:30]
        return _result(status, score, summary, details)
