#!/usr/bin/env python3
"""Refactor-amplification tracker — surfaces missing abstractions.

Thesis: when a single source change (`foo.py` split, function rename,
interface reshape) cascades into N follow-up callsite fixes across
separate commits, that amplification factor measures how tightly-coupled
the call sites are to an internal detail that SHOULD have been a stable
interface.

This session's canonical example: `_local_think` moved from
synthesis_llamacpp.py → synthesis_inference.py. Five separate commits
chased the followers (evolution_strategies, synthesis_warm, synthesis_pipeline
x2, tools_knowledge). The refactor commit said "split _local_think"; the
followers each said "fix X import". If we tracked this, a >3x
amplification factor would have flagged "there should be a stable
re-export module" BEFORE the followers landed.

Algorithm:
  1. For each commit in a recent window, extract the changed files.
  2. Group commits by "refactor-like" keywords in message (split, rename,
     move, extract, rework, refactor). These are the POTENTIAL AMPLIFIERS.
  3. Look forward N commits; count how many subsequent commits touched
     "bug-fix-like" files that were ALSO touched by the refactor commit
     (intersection = cascade followers).
  4. Amplification factor = followers / 1 (refactor itself) = just followers count.
  5. Emit JSON per refactor: {commit, msg, files_changed, followers_count,
     follower_commits, amplification_class}.

Classification:
  none (0) — refactor landed clean, no follower fixes needed.
  mild (1-2) — expected minor adjustments.
  concerning (3-5) — missing abstraction suspected; investigate.
  structural (>5) — clear "should have been an interface" signal.

Emits `metrics/refactor-amplification.jsonl` and summary stdout.

Usage: track-refactor-amplification.py [--window=50] [--json]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path


REFACTOR_KEYWORDS = re.compile(
    r"\b(split|rename|move|extract|rework|refactor|reorganiz|restructur|relocat)",
    re.IGNORECASE,
)
# Follower-commit keywords. These signal "I'm fixing something that broke."
FOLLOWER_KEYWORDS = re.compile(
    r"\b(fix|broken|stale|update|missing|chase|chase|catchup|catch up|cascade)",
    re.IGNORECASE,
)


def _require_project_root() -> Path:
    root = os.environ.get("PROJECT_ROOT")
    if root:
        return Path(root)
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        if (parent / ".env").exists() and (parent / "CLAUDE.md").exists():
            return parent
    raise RuntimeError("PROJECT_ROOT unresolved")


def _git(root: Path, *args: str) -> str:
    rc = subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True, text=True, timeout=30,
    )
    return rc.stdout


def _commit_files(root: Path, sha: str) -> set[str]:
    out = _git(root, "show", "--name-only", "--pretty=format:", sha)
    return {ln.strip() for ln in out.splitlines() if ln.strip()}


def _classify(n: int) -> str:
    if n == 0: return "none"
    if n <= 2: return "mild"
    if n <= 5: return "concerning"
    return "structural"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--window", type=int, default=50,
                    help="recent commits to scan (default 50)")
    ap.add_argument("--lookback", type=int, default=10,
                    help="commits to look forward from each refactor (default 10)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    try:
        root = _require_project_root()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    # Get recent commits newest-first.
    log_out = _git(root, "log", f"-n{args.window}", "--format=%H|%s")
    commits = []
    for line in log_out.splitlines():
        if "|" not in line:
            continue
        sha, msg = line.split("|", 1)
        commits.append((sha, msg))

    # Walk OLDEST-first so we can look forward for followers.
    commits.reverse()

    findings: list[dict] = []
    for i, (sha, msg) in enumerate(commits):
        if not REFACTOR_KEYWORDS.search(msg):
            continue
        refactor_files = _commit_files(root, sha)
        if not refactor_files:
            continue
        # Look forward up to --lookback commits for followers that touch
        # a subset of the same files and have a follower-keyword message.
        follower_window = commits[i + 1 : i + 1 + args.lookback]
        followers: list[dict] = []
        for f_sha, f_msg in follower_window:
            if not FOLLOWER_KEYWORDS.search(f_msg):
                continue
            f_files = _commit_files(root, f_sha)
            shared = refactor_files & f_files
            if shared:
                followers.append({
                    "sha": f_sha[:8],
                    "msg": f_msg[:80],
                    "shared_files": sorted(shared)[:5],
                })
        amp = len(followers)
        if amp == 0:
            continue
        findings.append({
            "refactor_sha": sha[:8],
            "refactor_msg": msg[:100],
            "refactor_files_changed": len(refactor_files),
            "followers_count": amp,
            "class": _classify(amp),
            "follower_commits": followers,
        })

    # Write JSONL
    out_path = root / "metrics" / "refactor-amplification.jsonl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        for entry in findings:
            f.write(json.dumps(entry) + "\n")

    if args.json:
        print(json.dumps(findings, indent=2))
    else:
        print(f"# Refactor-Amplification Audit  (window={args.window}, lookback={args.lookback})")
        print(f"  Amplifiers found: {len(findings)}")
        by_class = {"structural": [], "concerning": [], "mild": [], "none": []}
        for f in findings:
            by_class[f["class"]].append(f)
        for cls in ("structural", "concerning", "mild"):
            items = by_class[cls]
            if not items:
                continue
            print(f"\n## {cls.upper()} ({len(items)})")
            for f in items:
                print(f"  [{f['refactor_sha']}] {f['refactor_msg']}")
                print(f"    amplified {f['followers_count']}x across {len(f['follower_commits'])} follower commits:")
                for fc in f["follower_commits"][:3]:
                    print(f"      → [{fc['sha']}] {fc['msg']}")
                    if fc.get("shared_files"):
                        print(f"         shared: {', '.join(fc['shared_files'][:3])}")
                if len(f["follower_commits"]) > 3:
                    print(f"      ... ({len(f['follower_commits']) - 3} more)")
        if not any(by_class[c] for c in ("structural", "concerning")):
            print("\n  No concerning amplification detected in the window.")
        print(f"\n  Full report: {out_path.relative_to(root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
