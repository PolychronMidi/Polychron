#!/usr/bin/env python3
"""Audit broad-except / catch-and-swallow patterns in HME code.

Pattern B (from the architectural review): silent-on-failure observability
that drops the very signals it exists to surface. Catches like `except
Exception: pass` are correct for telemetry hot-paths but wrong for
load-bearing safety checks. The codebase has no convention to distinguish
the two -- every author falls back to broad-except + log-and-continue.

This audit doesn't auto-fix; it surfaces every catch-and-swallow site so
a reviewer can decide whether each is "telemetry (silence ok)" or
"safety-belt (must surface)".

Convention (proposed): mark intentionally-silent catches with one of:
  # silent-ok: telemetry-only -- failure does not affect correctness
  # silent-ok: best-effort enrichment -- caller has fallback
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


PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3])
HME_ROOTS = [
    PROJECT_ROOT / "tools" / "HME",
    PROJECT_ROOT / "scripts" / "hme",
    PROJECT_ROOT / "scripts" / "detectors",
]

# Patterns that swallow exceptions broadly without re-raising.
PYTHON_SWALLOW = re.compile(
    r"^\s*except\*?\s*(?:"
    r"(?:(?:Exception|BaseException)(?:\s+as\s+\w+)?)"
    r"|(?:\([^)]*\b(?:Exception|BaseException)\b[^)]*\)(?:\s+as\s+\w+)?)"
    r")?\s*:\s*$"
)
JS_SWALLOW = re.compile(r"^\s*(?:}\s*)?catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*$")
SH_SWALLOW = re.compile(r"\|\|\s*(?:true|:)\b|2\s*>\s*/dev/null\s*(?:[;)]|$)")
HEREDOC_START = re.compile(r"<<-?\s*[\"']?([A-Za-z_][A-Za-z0-9_]*)[\"']?")

# Tokens that mark a catch as intentionally silent.
SILENT_OK = re.compile(r"silent-ok\b|silent-except\b")

# Broad catches that visibly report the failure are not silent. Keep this
# conservative: only logging calls and standard verifier/result accumulators.
PY_SURFACED = re.compile(
    r"\b(?:logger|logging)\.(?:debug|info|warning|error|exception|critical)\b"
    r"|print\s*\("
    r"|\b(?:results|checks|issues|violations|failures|warnings|errors|details)\.append\s*\("
    r"|ctx\.register_critical_failure\s*\("
    r"|return\s+(?:errored|failed|warned|passed)\s*\("
    r"|return\s+f?[\"'][^\"']*(?:error|failed|failure|unavailable|unreadable)[^\"']*[\"']"
)

JS_SURFACED = re.compile(
    r"throw\b|ctx\.warn\b|console\.(?:error|warn)\b|process\.stderr\.write\s*\("
    r"|_lifesaverBlock\s*\(|_failClosedPolicyError\s*\(|logHookError\s*\("
    r"|recordProxyFailure\s*\(|reportFailure\s*\(|record\s*\(\s*\{\s*kind\s*:"
    r"|\bexit_code\s*:\s*[1-9]"
    r"|return\s+[^;\n]*(?:error|failure|failed|denied|blocked|unavailable)"
)


def _scan_python(path: Path) -> list[tuple[int, str]]:
    issues = []
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return issues
    for i, line in enumerate(lines, 1):
        if not PYTHON_SWALLOW.match(line):
            continue
        # Look ahead for handled bodies; otherwise require a nearby silent-ok.
        body = lines[i:i + 6]
        body_text = "\n".join(body)
        executable = [b for b in body if b.strip() and not b.lstrip().startswith('#')]
        if any(re.match(r"^\s*raise\b", b) for b in executable):
            continue  # explicit re-raise = handled
        if PY_SURFACED.search(body_text):
            continue
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
        if JS_SURFACED.search(body_text):
            continue
        context = "\n".join(lines[max(0, i - 3):i + 5])
        if SILENT_OK.search(context):
            continue
        issues.append((i, line.strip()))
    return issues


def _sh_control_flow_consumes_status(line: str) -> bool:
    """Return True when stderr is hidden but the exit status is the signal.

    These are not silent swallows: shell predicates intentionally suppress noisy
    stderr while `if`/`while`/`until` or an explicit return/exit branch consumes
    the command result. Assignments with `|| echo default` still get audited.
    """
    stripped = line.strip()
    if not stripped:
        return False
    if stripped.startswith(("'", '"')):
        return True  # quoted embedded script/string, not executable shell here
    if re.search(r"\|\|\s*(?:true|:)\b", stripped):
        return False
    if re.match(r"^(if|elif|while|until)\b", stripped):
        return True
    if re.match(r"^\[\[?.*\]\]?\s+2>/dev/null\s*\|\|\s*(?:return|exit)\b", stripped):
        return True
    return False


def _scan_sh(path: Path) -> list[tuple[int, str]]:
    issues = []
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return issues
    blocked = set()
    delimiter = None
    for n, raw in enumerate(lines, 1):
        if delimiter:
            blocked.add(n)
            if raw.strip() == delimiter:
                delimiter = None
            continue
        match = HEREDOC_START.search(raw)
        if match:
            delimiter = match.group(1)
    # Keep BENIGN narrow; `|| true` and `|| echo` defaults still need site-specific silent-ok.
    BENIGN = re.compile(
        r"\b(mkdir\s+-p|kill\s+-0|rm\s+-f|sed\s+-n|disown|source\s+|cat\s+\"\$"
        r"|date\s+-u|>>\s*[\"']?[\w/.-]+\.log)\b"
    )
    for i, line in enumerate(lines, 1):
        if i in blocked:
            continue
        if line.lstrip().startswith("#"):
            continue
        if not SH_SWALLOW.search(line):
            continue
        if BENIGN.search(line):
            continue
        if _sh_control_flow_consumes_status(line):
            continue
        # Allow if the same line or surrounding has silent-ok or _safe_*
        # helpers (which are themselves audited).
        context = "\n".join(lines[max(0, i - 4):i + 3])
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
