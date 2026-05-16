#!/usr/bin/env python3
"""i/why mode=verifier-coverage -- Horizon VI continuation.

verifier-utility (last turn) asked: "which verifiers carry no signal?"
This asks the inverse: "which file paths carry no verifier coverage?"

Walks tools/HME/, src/, scripts/ and counts lines of code per top-level
directory. Then introspects each verifier's source for grep patterns
or path constants that would touch each directory. Surfaces
uncovered/under-covered paths so the next verifier-author has a
data-driven prune list.

Heuristic only -- a verifier that walks os.walk(_PROJECT) covers
everything but doesn't appear to mention any specific path. So this
report flags POTENTIAL gaps, not certain ones."""
from __future__ import annotations
import os
import re
import sys
from collections import defaultdict

from _common import PROJECT_ROOT


def _count_files_per_dir() -> dict[str, int]:
    """Top-level dir -> file count, restricted to the dirs HME conceptually
    governs."""
    targets = ["tools/HME", "src", "scripts", "i", "doc"]
    counts: dict[str, int] = {}
    for t in targets:
        path = os.path.join(PROJECT_ROOT, t)
        if not os.path.isdir(path):
            continue
        n = 0
        for root, dirs, files in os.walk(path):
            dirs[:] = [d for d in dirs if not d.startswith(".")
                       and d not in ("__pycache__", "node_modules")]
            n += sum(1 for f in files
                     if f.endswith((".py", ".js", ".sh", ".ts", ".md", ".json")))
        counts[t] = n
    return counts


def _scan_verifier_path_mentions() -> dict[str, set[str]]:
    """For each verifier file, extract path mentions. Returns {dir: {verifier_filename}}."""
    pkg = os.path.join(PROJECT_ROOT, "tools", "HME", "scripts", "verify_coherence")
    targets = ["tools/HME", "src", "scripts", "i", "doc"]
    mentions: dict[str, set[str]] = defaultdict(set)
    if not os.path.isdir(pkg):
        return dict(mentions)
    for root, _d, files in os.walk(pkg):
        for f in files:
            if not f.endswith(".py") or f.startswith("_"):
                continue
            p = os.path.join(root, f)
            try:
                with open(p, encoding="utf-8") as fp:
                    src = fp.read()
            except OSError:
                continue
            for t in targets:
                # Match the directory string in source -- could appear as
                if re.search(rf'["\']{re.escape(t)}/', src):
                    mentions[t].add(f)
                # PROJECT_ROOT-walking verifiers cover all dirs implicitly
                if "_PROJECT" in src and "os.walk(_PROJECT)" in src:
                    mentions["_universal"].add(f)
    return dict(mentions)


def main(argv):
    file_counts = _count_files_per_dir()
    mentions = _scan_verifier_path_mentions()
    universal_count = len(mentions.get("_universal", set()))

    out = [f"# Verifier coverage by directory"]
    out.append("")
    out.append(f"  ({universal_count} verifier(s) walk PROJECT_ROOT -- "
               f"considered universal coverage)")
    out.append("")

    rows = []
    for d in sorted(file_counts.keys()):
        n_files = file_counts[d]
        n_verifiers = len(mentions.get(d, set()))
        rows.append((d, n_files, n_verifiers))

    rows.sort(key=lambda r: -r[1])
    print(f"# Verifier coverage by directory")
    print()
    print(f"  ({universal_count} verifier(s) walk PROJECT_ROOT -- universal coverage)")
    print()
    print(f"  {'directory':16}  {'files':>6}  {'verifiers':>10}  ratio")
    for d, n_files, n_verifiers in rows:
        ratio = n_verifiers / n_files * 100 if n_files else 0
        marker = " " if n_verifiers > 0 or universal_count > 0 else "!"
        print(f"  {marker} {d:14}  {n_files:>6}  {n_verifiers:>10}  {ratio:.1f} per 100 files")

    # Coverage gaps: dirs with 0 specific verifiers AND zero universal
    # walkers (rare -- usually at least one universal walker exists).
    gaps = [d for d, _n, v in rows if v == 0 and universal_count == 0]
    if gaps:
        print()
        print(f"## Coverage gaps ({len(gaps)}):")
        for d in gaps:
            print(f"  {d}")
    else:
        print()
        print("## Coverage gaps: none (universal walkers cover everything)")

    print()
    print("# Note:")
    print("  This is a heuristic -- verifiers that walk PROJECT_ROOT cover")
    print("  every directory implicitly. Specific-path verifiers are still")
    print("  the right shape for fast targeted checks. Use this view to")
    print("  identify where DEEP coverage (multiple specialized verifiers)")
    print("  is thin even though baseline coverage exists.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
