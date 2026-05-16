#!/usr/bin/env python3
"""Project-wide LOC audit. Honors config/loc-ignore.txt.

audit-core-principles.py only audits `src/` because four of its five
principles (P1 index.js, P3 self-registration, P4 single-manager hub,
plus the subsystem load order) are src-specific. P5 (LOC <= 350) is
universal -- this script applies just that one principle to the entire
repo so the LOC discipline that took a session to establish doesn't
re-rot anywhere outside src/.

Thresholds: WARN 250, CRITICAL 350 -- same source as audit-core-principles
(tools/HME/config/project-rules.json), so the two scripts can never drift.

Usage:
    python3 tools/HME/scripts/audit-loc.py            # default: tools/HME, scripts, src
    python3 tools/HME/scripts/audit-loc.py --json
    python3 tools/HME/scripts/audit-loc.py --strict   # exit 1 on any CRITICAL

Exit codes:
    0 -- no CRITICAL findings (WARN findings logged but do not fail)
    1 -- at least one CRITICAL finding when --strict
    2 -- usage error
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loc_ignore import load_patterns, is_exempt, load_with_rationale  # noqa: E402

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)

_DEFAULT_ROOTS = [
    os.path.join(_PROJECT, "src"),
    os.path.join(_PROJECT, "scripts"),
    os.path.join(_PROJECT, "tools", "HME"),
    os.path.join(_PROJECT, "doc"),  # markdown LOC enforcement; long-form essays + vendored READMEs handled via loc-ignore.txt
]

_SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv",
    "output", "csv_maestro", "bin", "pgmidi", "archive",
}
# `.md` added to the LOC discipline -- over-long doc rots faster than code.
_EXTS = {".py", ".js", ".ts", ".sh", ".md"}


def _load_thresholds():
    """Single source of truth -- same file audit-core-principles reads.

    Fail-fast: a malformed or missing config file used to silently
    fall back to (250, 350) defaults. That hid drift -- if someone
    accidentally deleted line_count_thresholds the audit would keep
    reporting "0 critical" against the wrong threshold. The agent-layer
    rule is "fail-fast, no silent fallbacks" -- apply it to the audit.
    """
    path = os.path.join(_PROJECT, "tools", "HME", "config", "project-rules.json")
    if not os.path.isfile(path):
        raise SystemExit(
            f"audit-loc: project-rules.json missing at {path!r}. "
            f"Refusing to use baked-in defaults -- that's the silent "
            f"fallback this audit exists to prevent."
        )
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f).get("line_count_thresholds", {})
    if "warn" not in cfg or "critical" not in cfg:
        raise SystemExit(
            f"audit-loc: project-rules.json missing line_count_thresholds. "
            f"Found keys: {list(cfg.keys())}"
        )
    return cfg["warn"], cfg["critical"]


def _loc(path: str) -> int:
    """Count non-blank, non-comment lines. Loud on read failures --
    silent 0 used to hide files we couldn't read (perm errors, encoding
    explosions); the audit reported "0 LOC" and the file silently
    skipped the threshold check.

    Extension-aware comment-stripping: `#` is a comment in py/sh but a
    HEADING in markdown. Stripping `#` lines from .md zeroed out every
    heading and made the audit blind to long docs.
    """
    ext = os.path.splitext(path)[1]
    if ext == ".md":
        # Markdown: count every non-blank line. Headings, body, lists,
        # code blocks all count. Long doc IS the failure mode.
        n = 0
        with open(path, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    n += 1
        return n
    # Code: skip lines whose stripped form starts with `#` (py/sh) or
    # `//` (js/ts).
    n = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if s and not s.startswith(("#", "//")):
                n += 1
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
    show_rationale = False
    paths = list(_DEFAULT_ROOTS)
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--json":
            as_json = True
        elif a == "--strict":
            strict = True
        elif a == "--rationale":
            show_rationale = True
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

    # Build rationale lookup. Each exemption may carry a structured
    exemption_records = load_with_rationale()

    if as_json:
        out = {
            "thresholds": {"warn": warn_t, "critical": crit_t},
            "critical": [{"loc": l, "path": p} for l, p in crit],
            "warn": [{"loc": l, "path": p} for l, p in warn],
        }
        if show_rationale:
            out["exemptions"] = exemption_records
        print(json.dumps(out, indent=2))
    else:
        print(f"audit-loc: WARN > {warn_t}, CRITICAL > {crit_t}")
        print(f"  CRITICAL: {len(crit)}")
        for loc, p in crit:
            print(f"    {loc:5d}  {p}")
        print(f"  WARN:     {len(warn)}")
        if show_rationale:
            with_r = [r for r in exemption_records if r["rationale"]]
            without = [r for r in exemption_records if not r["rationale"]]
            print(f"\n  Exemptions: {len(exemption_records)} total, "
                  f"{len(with_r)} with rationale, {len(without)} without")
            if with_r:
                print("  By intent:")
                by_intent: dict[str, list] = {}
                for r in with_r:
                    intent = r["rationale"].get("intent", "<unspecified>")
                    by_intent.setdefault(intent, []).append(r)
                for intent in sorted(by_intent):
                    items = by_intent[intent]
                    print(f"    {intent}: {len(items)}")
                    for r in items[:3]:
                        revisit = r["rationale"].get("revisit-when", "--")
                        print(f"      {r['pattern']}  (revisit: {revisit})")
                    if len(items) > 3:
                        print(f"      ... (+{len(items) - 3} more)")
            if without:
                print(f"  Exemptions WITHOUT rationale tokens "
                      f"({len(without)}) -- consider declaring intent:")
                for r in without[:5]:
                    print(f"    {r['pattern']}")
                if len(without) > 5:
                    print(f"    ... (+{len(without) - 5} more)")

    if strict and crit:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
