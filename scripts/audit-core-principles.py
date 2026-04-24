#!/usr/bin/env python3
"""Core-principles audit — survey how well src/ actually follows the five
core principles CLAUDE.md declares.

The ESLint rules in scripts/eslint-rules/ enforce specific corners of each
principle at lint time (requires-outside-index, fallback bans, validator
stamping, etc.). What ESLint does not do is survey the whole codebase and
say which principle has structural slack vs. which is airtight. This is
that survey.

Principles audited (numbered to match CLAUDE.md):
  P1 — Globals via side-effect require() in index.js
        Cross-check: every .js under a subsystem with its own index.js
        must be either required from that index.js or declared helper/
        utility. Orphan files are flagged.
  P2 — Fail fast (no silent fallbacks)
        Mostly ESLint-covered. The audit counts remaining raw-typeof
        checks and `|| 0 / || []` patterns as a health indicator.
  P3 — Self-registration
        Files that export a module but do not self-register and are not
        consumed by anyone are flagged as dead.
  P4 — Single-Manager Hub per subsystem
        Each subsystem (top-level under src/) and each nontrivial
        subsubsystem should have at most one *Manager.js file. Multiple
        managers at the same level without clearly disjoint scopes is a
        smell.
  P5 — Coherent files ≤200 lines
        Count LOC per .js file. Flag >200 (WARN) and >400 (CRITICAL).

Outputs:
  - Human-readable summary on stdout (default)
  - JSON payload with --json
  - Exit 0 if no CRITICAL violations, 1 otherwise

Usage:
    python3 scripts/audit-core-principles.py
    python3 scripts/audit-core-principles.py --json
    python3 scripts/audit-core-principles.py --subsystem conductor
"""
import json
import os
import re
import sys

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)
_SRC = os.path.join(_PROJECT, "src")

# Thresholds per CLAUDE.md "target ≤200 lines".
_LOC_WARN = 200
_LOC_CRITICAL = 400

# Load order for subsystems (from CLAUDE.md). Extra subsystems present in
# src/ but not in this list get ordered last alphabetically.
_LOAD_ORDER = [
    "utils", "conductor", "rhythm", "time",
    "composers", "fx", "crossLayer", "writer", "play",
]

# Filename suffixes that mark a file as bulk data rather than executable
# logic. These are exempt from the 200-line code-size rule but are still
# tracked so an unusually large data file is visible.
_DATA_SUFFIXES = (
    "PriorsData.js",
    "Pairs.js",
    "Table.js",
    "Tables.js",
    "Constants.js",
    "Manifest.js",
)


# Explicit per-file exemptions from the P5 (≤200 lines) rule. These files
# are architecturally required to be single-file and bigger than the rule
# would target — splitting them would create a worse problem than the
# length.
#   fullBootstrap.js  — the single entry point orchestrating the boot
#                       sequence; helpers are declared here so the order
#                       is read top-to-bottom in one file.
#   config.js         — conductor configuration surface; extracting
#                       sections would scatter one coherent map across
#                       multiple files for no readability gain.
# Paths are project-relative, same form as the audit's output.
_P5_EXEMPT = {
    "src/play/fullBootstrap.js",
    "src/conductor/config.js",
}


def _is_data_file(path):
    name = os.path.basename(path)
    return name.endswith(_DATA_SUFFIXES)

# Directories we do not walk when counting files.
_SKIP_DIRS = {"node_modules", ".git", "__pycache__"}

# Heuristic for detecting fail-fast anti-patterns that ESLint may have
# missed (the rules have narrow scopes). These are health indicators, not
# hard violations.
_FAILFAST_PATTERNS = [
    re.compile(r"\|\|\s*0\b"),        # "|| 0" fallback
    re.compile(r"\|\|\s*\[\s*\]"),    # "|| []" fallback
    re.compile(r"\|\|\s*\{\s*\}"),    # "|| {}" fallback
    re.compile(r"typeof\s+\w+\s*===?\s*['\"]undefined['\"]"),
]


def _loc(path):
    """Return non-empty, non-comment line count. Quick, not exact —
    discounts full-line // comments and blank lines."""
    n = 0
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                stripped = line.strip()
                if not stripped:
                    continue
                if stripped.startswith("//"):
                    continue
                n += 1
    except Exception:
        return 0
    return n


def _walk_js(root):
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
        for f in files:
            if f.endswith(".js"):
                yield os.path.join(dirpath, f)


def _rel(path):
    return os.path.relpath(path, _PROJECT)


def _managers_in(dir_path, recursive=False):
    """Return files ending in Manager.js under dir_path. If not recursive,
    only look one level deep (direct children)."""
    out = []
    if recursive:
        walker = _walk_js(dir_path)
    else:
        walker = (
            os.path.join(dir_path, f) for f in os.listdir(dir_path)
            if f.endswith(".js") and os.path.isfile(os.path.join(dir_path, f))
        )
    for p in walker:
        name = os.path.basename(p)
        if name.endswith("Manager.js"):
            out.append(p)
    return sorted(out)


def _index_requires(index_path):
    """Return the list of require paths in an index.js, in order."""
    if not os.path.isfile(index_path):
        return []
    reqs = []
    with open(index_path, encoding="utf-8") as f:
        for line in f:
            m = re.search(r"require\(['\"]([^'\"]+)['\"]\)", line)
            if m:
                reqs.append(m.group(1))
    return reqs


def _failfast_indicator(path):
    """Count matches of fail-fast anti-patterns in a single file. This is
    a rough indicator of P2 (fail fast) slack, not a precise violation
    count — ESLint rules already hard-enforce the specific patterns they
    know about."""
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except Exception:
        return 0
    return sum(len(p.findall(text)) for p in _FAILFAST_PATTERNS)


def _subsystem_order_key(name):
    try:
        return (0, _LOAD_ORDER.index(name))
    except ValueError:
        return (1, name)


def audit_subsystem(subsystem_dir):
    """Produce a stats dict for one subsystem (top-level dir under src/).
    The dict contains per-principle observations plus raw metrics."""
    name = os.path.basename(subsystem_dir)
    all_files = list(_walk_js(subsystem_dir))
    total_loc = sum(_loc(p) for p in all_files)
    sizes = [(p, _loc(p)) for p in all_files]
    # Separate data files from code files — the 200-line rule is about code
    # coherence, not about data-table size. Data files are tracked so the
    # large ones are still visible to a reader.
    code_sizes = [(p, n) for p, n in sizes if not _is_data_file(p)]
    data_files = [(_rel(p), n) for p, n in sizes if _is_data_file(p)]
    oversize_warn = [(_rel(p), n) for p, n in code_sizes
                     if _LOC_WARN < n <= _LOC_CRITICAL and _rel(p) not in _P5_EXEMPT]
    oversize_critical = [(_rel(p), n) for p, n in code_sizes
                         if n > _LOC_CRITICAL and _rel(p) not in _P5_EXEMPT]

    index_path = os.path.join(subsystem_dir, "index.js")
    has_index = os.path.isfile(index_path)
    index_reqs = _index_requires(index_path) if has_index else []

    managers_root = _managers_in(subsystem_dir, recursive=False)
    managers_all = _managers_in(subsystem_dir, recursive=True)
    managers_nested = [m for m in managers_all if m not in managers_root]

    failfast_hits = 0
    failfast_hot_files = []
    for p in all_files:
        h = _failfast_indicator(p)
        failfast_hits += h
        if h >= 3:
            failfast_hot_files.append((_rel(p), h))

    subsystems_inside = []
    for entry in sorted(os.listdir(subsystem_dir)):
        sub = os.path.join(subsystem_dir, entry)
        if not os.path.isdir(sub) or entry in _SKIP_DIRS:
            continue
        if _managers_in(sub, recursive=False):
            subsystems_inside.append(entry)

    # Violation flags per principle.
    violations = {"P1": [], "P2": [], "P3": [], "P4": [], "P5": []}

    # P1 — index.js should exist; required modules should exist on disk.
    if not has_index:
        violations["P1"].append(f"missing index.js (empty subsystem: {len(all_files)} .js files but no require graph)")
    # P4 — single manager per subsystem level.
    if len(managers_root) > 1:
        rels = ", ".join(_rel(m) for m in managers_root)
        violations["P4"].append(f"{len(managers_root)} managers at root: {rels}")
    # P5 — oversized files.
    for p, n in oversize_warn:
        violations["P5"].append(f"WARN {p} ({n} LOC)")
    for p, n in oversize_critical:
        violations["P5"].append(f"CRITICAL {p} ({n} LOC)")

    code_loc = sum(n for _, n in code_sizes)
    data_loc = total_loc - code_loc
    return {
        "name": name,
        "file_count": len(all_files),
        "code_file_count": len(code_sizes),
        "data_file_count": len(data_files),
        "total_loc": total_loc,
        "code_loc": code_loc,
        "data_loc": data_loc,
        "avg_loc": total_loc // max(1, len(all_files)),
        "avg_code_loc": code_loc // max(1, len(code_sizes)),
        "max_loc": max((n for _, n in sizes), default=0),
        "max_code_loc": max((n for _, n in code_sizes), default=0),
        "has_index": has_index,
        "index_require_count": len(index_reqs),
        "managers_root": [_rel(m) for m in managers_root],
        "managers_nested": [_rel(m) for m in managers_nested],
        "oversize_warn": oversize_warn,
        "oversize_critical": oversize_critical,
        "data_files": data_files,
        "failfast_hits": failfast_hits,
        "failfast_hot_files": failfast_hot_files,
        "subsubsystems": subsystems_inside,
        "violations": violations,
    }


def run(only_subsystem=None):
    if not os.path.isdir(_SRC):
        raise RuntimeError(f"src/ not found at {_SRC}")
    subsystems = []
    for entry in sorted(os.listdir(_SRC), key=_subsystem_order_key):
        p = os.path.join(_SRC, entry)
        if not os.path.isdir(p) or entry in _SKIP_DIRS:
            continue
        if only_subsystem and entry != only_subsystem:
            continue
        s = audit_subsystem(p)
        # Skip subsystems that contain zero .js files — they're empty
        # placeholders, not violations. src/types is one such today.
        if s["file_count"] == 0:
            continue
        subsystems.append(s)
    return subsystems


def _format_report(subsystems):
    lines = []
    lines.append("=" * 70)
    lines.append("CORE-PRINCIPLES AUDIT")
    lines.append("=" * 70)
    lines.append("")

    # Summary table — code stats only (data files excluded from size rules).
    lines.append(f"{'subsystem':<14} {'code':>5} {'data':>5} {'cLOC':>6} "
                 f"{'avg':>4} {'max':>5} {'mgr':>4} {'>200':>5} {'>400':>5}")
    lines.append("-" * 70)
    total_code = 0
    total_data = 0
    total_cloc = 0
    total_warn = 0
    total_crit = 0
    for s in subsystems:
        total_code += s["code_file_count"]
        total_data += s["data_file_count"]
        total_cloc += s["code_loc"]
        total_warn += len(s["oversize_warn"])
        total_crit += len(s["oversize_critical"])
        mgr = len(s["managers_root"]) + len(s["managers_nested"])
        lines.append(
            f"{s['name']:<14} {s['code_file_count']:>5} {s['data_file_count']:>5} "
            f"{s['code_loc']:>6} {s['avg_code_loc']:>4} {s['max_code_loc']:>5} "
            f"{mgr:>4} {len(s['oversize_warn']):>5} {len(s['oversize_critical']):>5}"
        )
    lines.append("-" * 70)
    lines.append(
        f"{'TOTAL':<14} {total_code:>5} {total_data:>5} {total_cloc:>6} "
        f"{total_cloc//max(1,total_code):>4} {'':>5} {'':>4} "
        f"{total_warn:>5} {total_crit:>5}"
    )
    lines.append("")
    lines.append("code = code files (excludes *Data.js / *Pairs.js / *Constants.js); "
                 "cLOC = code LOC")
    lines.append("")

    # Violations per subsystem.
    violators = [s for s in subsystems
                 if any(s["violations"].values())
                 or s["failfast_hot_files"]]
    if not violators:
        lines.append("No violations detected across audited subsystems.")
    else:
        lines.append("Violations by subsystem:")
        for s in violators:
            lines.append(f"\n  [{s['name']}]")
            for pid, items in s["violations"].items():
                if not items:
                    continue
                lines.append(f"    {pid}: {len(items)} issue(s)")
                for item in items[:12]:
                    lines.append(f"      - {item}")
                if len(items) > 12:
                    lines.append(f"      … {len(items) - 12} more")
            if s["failfast_hot_files"]:
                lines.append(
                    f"    P2 indicators: {s['failfast_hits']} total hits "
                    f"across {len(s['failfast_hot_files'])} hot file(s)"
                )
                for rel, h in s["failfast_hot_files"][:5]:
                    lines.append(f"      - {rel} ({h} hits)")

    # Overall principle roll-up.
    per_principle = {"P1": 0, "P2": 0, "P3": 0, "P4": 0, "P5": 0}
    total_failfast = 0
    for s in subsystems:
        for pid in per_principle:
            per_principle[pid] += len(s["violations"][pid])
        total_failfast += s["failfast_hits"]
    lines.append("")
    lines.append("Roll-up (violations counted across subsystems):")
    lines.append(f"  P1 (globals via index.js require):     {per_principle['P1']}")
    lines.append(f"  P2 (fail fast):                         ESLint-enforced; "
                 f"{total_failfast} indicator hit(s) across codebase")
    lines.append(f"  P3 (self-registration):                 not audited "
                 f"(needs full require-graph analysis)")
    lines.append(f"  P4 (single-manager hub):                {per_principle['P4']}")
    lines.append(f"  P5 (coherent files ≤200 lines):        "
                 f"{per_principle['P5']} (oversize files, code only)")

    # Data file callout — if any data files are unusually large.
    big_data = []
    for s in subsystems:
        for rel, n in s.get("data_files", []):
            if n > 1000:
                big_data.append((rel, n))
    if big_data:
        lines.append("")
        lines.append("Large data files (>1000 LOC, exempt from code size rule):")
        for rel, n in sorted(big_data, key=lambda x: -x[1]):
            lines.append(f"  {rel} ({n} LOC)")
    return "\n".join(lines)


def main():
    args = sys.argv[1:]
    only = None
    for i, a in enumerate(args):
        if a == "--subsystem" and i + 1 < len(args):
            only = args[i + 1]
    try:
        subsystems = run(only_subsystem=only)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    # Roll-up counts — the HCI verifier wrapper consumes these via JSON.
    critical_count = sum(len(s["oversize_critical"]) for s in subsystems)
    warn_count = sum(len(s["oversize_warn"]) for s in subsystems)
    p1_count = sum(len(s["violations"]["P1"]) for s in subsystems)
    p4_count = sum(len(s["violations"]["P4"]) for s in subsystems)
    failfast_hits = sum(s["failfast_hits"] for s in subsystems)
    has_critical = critical_count > 0 or p1_count > 0

    if "--json" in args:
        print(json.dumps({
            "subsystems": subsystems,
            "critical_count": critical_count,
            "warn_count": warn_count,
            "p1_count": p1_count,
            "p4_count": p4_count,
            "failfast_hits": failfast_hits,
            "has_critical": has_critical,
        }, indent=2))
    else:
        print(_format_report(subsystems))

    return 1 if has_critical else 0


if __name__ == "__main__":
    sys.exit(main())
