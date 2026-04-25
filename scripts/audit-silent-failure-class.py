#!/usr/bin/env python3
"""Audit broad-except / catch-and-swallow patterns in HME code.

Pattern B (from the architectural review): silent-on-failure observability
that drops the very signals it exists to surface. Catches like `except
Exception: pass` are correct for telemetry hot-paths but wrong for
load-bearing safety checks. The codebase has no convention to distinguish
the two — every author falls back to broad-except + log-and-continue.

This audit doesn't auto-fix; it surfaces every catch-and-swallow site so
a reviewer can decide whether each is "telemetry (silence ok)" or
"safety-belt (must surface)".

Convention (proposed): mark intentionally-silent catches with one of:
  # silent-ok: telemetry-only — failure does not affect correctness
  # silent-ok: best-effort enrichment — caller has fallback
  # silent-ok: <one-line reason>
Anything without a `silent-ok:` marker that swallows broad Exception
should either log + raise, or convert to a typed except.

Output: list of file:line:line-content for each unmarked silent catch.
Exit 1 when any unmarked sites exist (so the verifier can gate).
Exit 0 when all silent catches are annotated.
"""
import os
import re
import sys
from pathlib import Path


PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", "/home/jah/Polychron"))
HME_ROOTS = [
    PROJECT_ROOT / "tools" / "HME",
    PROJECT_ROOT / "scripts" / "hme",
    PROJECT_ROOT / "scripts" / "detectors",
]

# Patterns that swallow exceptions broadly without re-raising.
PYTHON_SWALLOW = re.compile(
    r"^\s*(?:except(?:\s+(?:Exception|BaseException))?(?:\s+as\s+\w+)?\s*:\s*$)"
)
JS_SWALLOW = re.compile(r"^\s*}\s*catch\s*\(\s*\w+\s*\)\s*\{\s*$")
SH_SWALLOW = re.compile(r"\|\|\s*true\b|\|\|\s*:\b|2>/dev/null\s*$")

# Tokens that mark a catch as intentionally silent.
SILENT_OK = re.compile(r"silent-ok\b|silent-except\b")


def _scan_python(path: Path) -> list[tuple[int, str]]:
    issues = []
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return issues
    for i, line in enumerate(lines, 1):
        if not PYTHON_SWALLOW.match(line):
            continue
        # Look at the next 3 lines — a `pass` or empty body without a
        # silent-ok marker on the except line, body, or comment block
        # within 5 lines is a candidate.
        body = lines[i:i + 5]
        body_text = "\n".join(body)
        if "raise" in body_text or "return" in body_text and "default" not in body_text.lower():
            continue  # explicit re-raise / explicit return = handled
        context = "\n".join(lines[max(0, i - 3):i + 5])
        if SILENT_OK.search(context):
            continue
        issues.append((i, line.strip()))
    return issues


def _scan_js(path: Path) -> list[tuple[int, str]]:
    issues = []
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return issues
    for i, line in enumerate(lines, 1):
        if not JS_SWALLOW.match(line):
            continue
        body = lines[i:i + 5]
        body_text = "\n".join(body)
        if "throw" in body_text or "ctx.warn" in body_text or "console.error" in body_text:
            continue
        context = "\n".join(lines[max(0, i - 3):i + 5])
        if SILENT_OK.search(context):
            continue
        issues.append((i, line.strip()))
    return issues


def _scan_sh(path: Path) -> list[tuple[int, str]]:
    issues = []
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return issues
    # Idiomatic 2>/dev/null patterns that aren't a safety concern: directory
    # bookkeeping (mkdir -p), liveness probes (kill -0), best-effort helpers
    # (rm -f, sed -n, cat for default fallback, date for timestamp, disown),
    # logger appends (>> log), source guards. These are the noise that made
    # the broad audit non-actionable.
    BENIGN = re.compile(
        r"\b(mkdir\s+-p|kill\s+-0|rm\s+-f|sed\s+-n|disown|source\s+|cat\s+\"\$"
        r"|date\s+-u|>>\s*[\"']?[\w/.-]+\.log|\|\|\s*echo|\|\|\s*true)\b"
    )
    for i, line in enumerate(lines, 1):
        if "2>/dev/null" not in line:
            continue
        if BENIGN.search(line):
            continue
        # Allow if the same line or surrounding has silent-ok or _safe_*
        # helpers (which are themselves audited).
        context = "\n".join(lines[max(0, i - 2):i + 1])
        if SILENT_OK.search(context) or "_safe_" in line:
            continue
        issues.append((i, line.strip()[:120]))
    return issues


def main() -> int:
    total = 0
    by_file: dict[str, list] = {}
    for root in HME_ROOTS:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if not p.is_file() or "__pycache__" in str(p) or "node_modules" in str(p):
                continue
            if p.suffix == ".py":
                hits = _scan_python(p)
            elif p.suffix == ".js":
                hits = _scan_js(p)
            elif p.suffix == ".sh":
                hits = _scan_sh(p)
            else:
                continue
            if hits:
                rel = p.relative_to(PROJECT_ROOT)
                by_file[str(rel)] = hits
                total += len(hits)

    if not total:
        print("audit-silent-failure-class: no unmarked silent-catch sites found")
        return 0
    print(f"audit-silent-failure-class: {total} unmarked silent-catch sites across "
          f"{len(by_file)} files")
    print("each site should either: (a) log + raise / surface to caller, OR")
    print("(b) be annotated with a `silent-ok: <reason>` comment within 3 lines")
    print()
    for fp in sorted(by_file)[:30]:  # cap output for readability
        print(f"  {fp}:")
        for ln, src in by_file[fp][:5]:
            print(f"    {ln}: {src}")
    if len(by_file) > 30:
        print(f"  ... and {len(by_file) - 30} more files")
    return 1


if __name__ == "__main__":
    sys.exit(main())
