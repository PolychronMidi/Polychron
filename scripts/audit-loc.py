#!/usr/bin/env python3
"""Project-wide LOC audit. Honors config/loc-ignore.txt.

audit-core-principles.py only audits `src/` because four of its five
principles (P1 index.js, P3 self-registration, P4 single-manager hub,
plus the subsystem load order) are src-specific. P5 (LOC <= 350) is
universal — this script applies just that one principle to the entire
repo so the LOC discipline that took a session to establish doesn't
re-rot anywhere outside src/.

Thresholds: WARN 250, CRITICAL 350 — same source as audit-core-principles
(tools/HME/config/project-rules.json), so the two scripts can never drift.

Usage:
    python3 scripts/audit-loc.py            # default: tools/HME, scripts, src
    python3 scripts/audit-loc.py --json
    python3 scripts/audit-loc.py --strict   # exit 1 on any CRITICAL

Exit codes:
    0 — no CRITICAL findings (WARN findings logged but do not fail)
    1 — at least one CRITICAL finding when --strict
    2 — usage error
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loc_ignore import load_patterns, is_exempt  # noqa: E402

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)

_DEFAULT_ROOTS = [
    os.path.join(_PROJECT, "src"),
    os.path.join(_PROJECT, "scripts"),
    os.path.join(_PROJECT, "tools", "HME"),
]

_SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv",
    "output", "doc", "csv_maestro", "bin", "pgmidi", "archive",
}
_EXTS = {".py", ".js", ".ts", ".sh"}


def _load_thresholds():
    """Single source of truth — same file audit-core-principles reads."""
    path = os.path.join(_PROJECT, "tools", "HME", "config", "project-rules.json")
    try:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f).get("line_count_thresholds", {})
        return cfg.get("warn", 250), cfg.get("critical", 350)
    except (OSError, ValueError):
        return 250, 350


def _loc(path: str) -> int:
    n = 0
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if s and not s.startswith(("#", "//")):
                    n += 1
    except OSError:
        return 0
    return n


def _walk(roots, ignore_patterns):
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dp, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in _SKIP_DIRS and not d.startswith(".")]
            for f in files:
                if os.path.splitext(f)[1] not in _EXTS:
                    continue
                path = os.path.join(dp, f)
                rel = os.path.relpath(path, _PROJECT)
                if is_exempt(rel, ignore_patterns):
                    continue
                yield path, rel


def main(argv: list) -> int:
    as_json = False
    strict = False
    paths = list(_DEFAULT_ROOTS)
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--json":
            as_json = True
        elif a == "--strict":
            strict = True
        elif a == "--path":
            i += 1
            if i >= len(argv):
                sys.stderr.write("--path requires an argument\n")
                return 2
            paths = [os.path.join(_PROJECT, argv[i])]
        elif a in ("-h", "--help"):
            print(__doc__)
            return 0
        else:
            sys.stderr.write(f"unknown arg: {a}\n")
            return 2
        i += 1

    warn_t, crit_t = _load_thresholds()
    patterns = load_patterns()
    crit, warn = [], []
    for path, rel in _walk(paths, patterns):
        loc = _loc(path)
        if loc > crit_t:
            crit.append((loc, rel))
        elif loc > warn_t:
            warn.append((loc, rel))
    crit.sort(reverse=True)
    warn.sort(reverse=True)

    if as_json:
        print(json.dumps({
            "thresholds": {"warn": warn_t, "critical": crit_t},
            "critical": [{"loc": l, "path": p} for l, p in crit],
            "warn": [{"loc": l, "path": p} for l, p in warn],
        }, indent=2))
    else:
        print(f"audit-loc: WARN > {warn_t}, CRITICAL > {crit_t}")
        print(f"  CRITICAL: {len(crit)}")
        for loc, p in crit:
            print(f"    {loc:5d}  {p}")
        print(f"  WARN:     {len(warn)}")

    if strict and crit:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
