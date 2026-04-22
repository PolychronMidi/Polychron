#!/usr/bin/env python3
"""H13: A verifier that invents new verifiers.

Scans git log for recent "fix"/"bug"/"regression" commits, extracts the
files they touched, and checks whether a matching verifier in
verify-coherence.py targets the same file/pattern. Uncovered fixes are
regression-surface gaps: the bug was fixed once, but there's nothing to
catch the next instance of the same class.

Output: metrics/hme-verifier-coverage.json with:
  - recent fix commits (last 50)
  - per-commit: files touched + whether any verifier covers them
  - gaps: commits with no matching verifier
  - suggested verifier stubs (Python class skeleton per gap)

The system recursively extends its own immune system: each bug fix
becomes either a regression guard or a flagged gap.

Usage:
    python3 tools/HME/scripts/suggest-verifiers.py
    python3 tools/HME/scripts/suggest-verifiers.py --stub  # print Python stubs
"""
import json
import os
import re
import subprocess
import sys
import time

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_VERIFIER_SRC = os.path.join(
    _PROJECT, "tools", "HME", "scripts", "verify-coherence.py"
)
_OUTPUT = os.path.join(METRICS_DIR, "hme-verifier-coverage.json")

_FIX_KEYWORDS = (
    "fix", "bug", "regression", "repair", "patch",
    "correct", "broken", "misroute", "hallucinat", "dampen",
)


def _recent_fix_commits(limit: int = 50) -> list:
    try:
        rc = subprocess.run(
            ["git", "-C", _PROJECT, "log", "--oneline", f"-{limit}"],
            capture_output=True, text=True, timeout=5,
        )
    except Exception:
        return []
    commits = []
    for line in rc.stdout.splitlines():
        parts = line.split(" ", 1)
        if len(parts) != 2:
            continue
        sha, msg = parts
        if any(kw in msg.lower() for kw in _FIX_KEYWORDS):
            commits.append({"sha": sha, "message": msg})
    return commits


def _files_in_commit(sha: str) -> list:
    try:
        rc = subprocess.run(
            ["git", "-C", _PROJECT, "show", "--name-only", "--format=", sha],
            capture_output=True, text=True, timeout=5,
        )
        return [f for f in rc.stdout.splitlines() if f.strip()]
    except Exception:
        return []


def _verifier_coverage() -> set:
    """Extract from verify-coherence.py: set of file-path fragments that
    any verifier references in its source. A verifier 'covers' a file if
    its source mentions the file's name or a near-match."""
    coverage = set()
    if not os.path.isfile(_VERIFIER_SRC):
        return coverage
    try:
        with open(_VERIFIER_SRC) as f:
            src = f.read()
    except Exception:
        return coverage
    # File path references inside verifier source
    for m in re.finditer(r'["\']([a-zA-Z_][a-zA-Z0-9_/.-]*\.(?:py|sh|js|ts|md|json))["\']', src):
        coverage.add(m.group(1))
    # Module-name references (identifiers that look like filenames)
    for m in re.finditer(r'["\']([a-zA-Z_][a-zA-Z0-9_]+)["\']', src):
        name = m.group(1)
        if len(name) > 4 and "_" in name:
            coverage.add(name)
    return coverage


def _is_covered(files: list, coverage: set) -> tuple:
    covered = []
    uncovered = []
    for f in files:
        base = os.path.basename(f)
        stem = os.path.splitext(base)[0]
        hit = False
        for c in coverage:
            if c == f or c == base or c == stem or stem in c or c in f:
                hit = True
                break
        if hit:
            covered.append(f)
        else:
            uncovered.append(f)
    return covered, uncovered


def _suggest_stub(commit: dict, uncovered_files: list) -> str:
    """Draft a Python verifier class skeleton for an uncovered fix."""
    file_sample = uncovered_files[0] if uncovered_files else "unknown"
    base = os.path.basename(file_sample)
    class_name = re.sub(r'\W', '', "".join(w.capitalize() for w in base.split("_"))) + "Verifier"
    return f'''class {class_name}(Verifier):
    """Regression guard for commit {commit["sha"][:8]}: {commit["message"][:60]}.

    Uncovered files at time of commit:
{chr(10).join(f"      {f}" for f in uncovered_files)}

    Draft this verifier's run() to catch the next instance of the same bug class.
    Replace this TODO with an ast/regex check against the relevant file.
    """
    name = "{class_name.lower().replace('verifier', '')}"
    category = "runtime"  # TODO: choose category
    weight = 1.0

    def run(self) -> VerdictResult:
        # TODO: implement regression check for {file_sample}
        return _result(SKIP, 1.0, "stub — implement regression check")'''


def scan() -> dict:
    commits = _recent_fix_commits(limit=50)
    coverage = _verifier_coverage()
    gaps = []
    covered_commits = 0
    for commit in commits:
        files = _files_in_commit(commit["sha"])
        if not files:
            continue
        covered, uncovered = _is_covered(files, coverage)
        if uncovered and not covered:
            gaps.append({
                "sha": commit["sha"],
                "message": commit["message"],
                "uncovered_files": uncovered,
                "suggested_stub_name": re.sub(
                    r'\W', '',
                    "".join(w.capitalize() for w in
                            os.path.splitext(os.path.basename(uncovered[0]))[0].split("_"))
                ) + "Verifier",
            })
        elif covered:
            covered_commits += 1
    return {
        "generated_at": time.time(),
        "commits_scanned": len(commits),
        "commits_with_verifier_coverage": covered_commits,
        "gaps": gaps[:20],
        "gap_count": len(gaps),
        "verifier_source_terms": len(coverage),
    }


def main(argv: list) -> int:
    data = scan()
    os.makedirs(os.path.dirname(_OUTPUT), exist_ok=True)
    with open(_OUTPUT, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Coverage report: {_OUTPUT}")
    print(f"  fix commits scanned: {data['commits_scanned']}")
    print(f"  with verifier coverage: {data['commits_with_verifier_coverage']}")
    print(f"  gaps: {data['gap_count']}")
    if "--stub" in argv:
        # Print Python stubs for all gaps
        print()
        print("# Suggested verifier stubs")
        for gap in data["gaps"][:5]:
            commits = _recent_fix_commits(limit=50)
            commit = next((c for c in commits if c["sha"] == gap["sha"]), None)
            if commit:
                print(_suggest_stub(commit, gap["uncovered_files"]))
                print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
