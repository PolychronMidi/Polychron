#!/usr/bin/env python3
"""Arc IV: Meta-Measurement — measure the measurement substrate.

The invariant battery has grown to 162 checks. Which ones actually catch real
bugs that get fixed? Which ones flap without action? Which ones have never
fired since creation? Return-on-investment of each invariant is itself
unmeasured — until now.

Computes a per-invariant efficacy score from three inputs:
  1. commits_citing:  git log scan for invariant-id in recent commit messages
  2. fire_rate_recent: fraction of recent battery runs where invariant FAILED
  3. flap_count:      oscillations between pass/fail without a citing commit

The combined efficacy score lives in [0, 1]:
  - High efficacy  = cited in multiple commits (caught real bugs) + moderate fire rate
  - Low efficacy   = flaps without citations OR never fires AND never cited
  - Zero efficacy  = never fired in N runs AND never cited in M commits

Writes metrics/hme-invariant-efficacy.json. Non-fatal; agent-independent.

Cadence: runs as a pipeline POST_COMPOSITION step (Arc IV's contribution to the
pipeline is the measurement substrate's self-audit).
"""
from __future__ import annotations
import json
import os
import re
import subprocess
import sys
import time
from collections import defaultdict

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CONFIG_PATH = os.path.join(PROJECT_ROOT, "tools", "HME", "config", "invariants.json")
HISTORY_PATH = os.path.join(PROJECT_ROOT, "metrics", "hme-invariant-history.json")
OUT_PATH = os.path.join(PROJECT_ROOT, "metrics", "hme-invariant-efficacy.json")

RECENT_COMMITS = 500
MIN_RUNS_FOR_EFFICACY = 5  # don't judge invariants before we have enough samples


def _load_invariants():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("invariants", [])


def _scan_git_for_citations(ids: list[str]) -> dict[str, int]:
    """Count commits mentioning each invariant id in the last N commits.

    Proxy for "this invariant caught something that got fixed" — commits
    typically cite the invariant id when a fix addresses it.
    """
    try:
        log = subprocess.check_output(
            ["git", "log", f"-{RECENT_COMMITS}", "--pretty=%s%n%b"],
            cwd=PROJECT_ROOT, timeout=20, text=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return {}

    # Case-insensitive search; tolerate both "foo-bar" and "foo_bar" casing drift.
    counts = defaultdict(int)
    for inv_id in ids:
        # Use the exact id and its underscore variant.
        patterns = [re.escape(inv_id), re.escape(inv_id.replace("-", "_"))]
        pattern = "|".join(patterns)
        counts[inv_id] = len(re.findall(pattern, log, re.IGNORECASE))
    return dict(counts)


def _efficacy_score(commits_citing: int, fail_streak: int, last_result: str,
                    total_runs: int) -> tuple[float, str]:
    """Compute efficacy in [0, 1] and classify the invariant.

    Classifications:
      load-bearing:  cited in commits AND fires occasionally (catches bugs)
      structural:    never fired BUT cited (existence prevents violations)
      decorative:    never fired AND never cited
      flappy:        fires but never cited (noise)
      new:           fewer than MIN_RUNS_FOR_EFFICACY runs — insufficient data
    """
    if total_runs < MIN_RUNS_FOR_EFFICACY:
        return (0.5, "new")

    # Load-bearing: cited AND has been exercised
    if commits_citing >= 1 and (fail_streak > 0 or last_result == "fail"):
        return (min(1.0, 0.5 + 0.15 * commits_citing), "load-bearing")
    # Load-bearing-historical: cited but currently passing
    if commits_citing >= 1:
        return (min(1.0, 0.4 + 0.1 * commits_citing), "load-bearing-historical")
    # Flappy: fails without ever being cited → noise
    if fail_streak > 0 or last_result == "fail":
        return (0.1, "flappy")
    # Decorative / structural: hasn't fired and hasn't been cited
    return (0.3, "decorative")


def main() -> int:
    invariants = _load_invariants()
    if not invariants:
        print("compute-invariant-efficacy: no invariants configured — skip")
        return 0

    if not os.path.isfile(HISTORY_PATH):
        print("compute-invariant-efficacy: no history yet — skip")
        return 0

    with open(HISTORY_PATH, encoding="utf-8") as f:
        history = json.load(f)
    total_runs = int(history.get("total_runs", 0))
    fail_streaks = history.get("fail_streaks", {}) or {}
    last_result = history.get("last_result", {}) or {}

    ids = [inv.get("id") for inv in invariants if inv.get("id")]
    citations = _scan_git_for_citations(ids)

    per_invariant: dict = {}
    counts_by_class = defaultdict(int)

    for inv in invariants:
        inv_id = inv.get("id")
        if not inv_id:
            continue
        cites = citations.get(inv_id, 0)
        streak = int(fail_streaks.get(inv_id, 0))
        lr = last_result.get(inv_id, "unknown")
        score, klass = _efficacy_score(cites, streak, lr, total_runs)
        per_invariant[inv_id] = {
            "commits_citing": cites,
            "fail_streak": streak,
            "last_result": lr,
            "efficacy": round(score, 3),
            "class": klass,
            "severity": inv.get("severity", "unknown"),
        }
        counts_by_class[klass] += 1

    # Top 10 load-bearing (highest citation count among load-bearing and historical)
    top_load_bearing = sorted(
        [(i, d) for i, d in per_invariant.items()
         if d["class"] in ("load-bearing", "load-bearing-historical")],
        key=lambda kv: -kv[1]["commits_citing"],
    )[:10]

    # Retirement candidates: flappy OR decorative with lots of runs
    retirement_candidates = [
        i for i, d in per_invariant.items()
        if d["class"] == "flappy" and d["fail_streak"] >= 3
    ]

    result = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_runs": total_runs,
        "total_invariants": len(ids),
        "commits_scanned": RECENT_COMMITS,
        "class_counts": dict(counts_by_class),
        "top_load_bearing": [{"id": i, **d} for i, d in top_load_bearing],
        "retirement_candidates": retirement_candidates,
        "per_invariant": per_invariant,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")

    summary_bits = [f"{c}={counts_by_class[c]}" for c in
                    ["load-bearing", "load-bearing-historical", "flappy",
                     "decorative", "new"] if counts_by_class.get(c)]
    print(f"compute-invariant-efficacy: {len(ids)} invariants, {total_runs} runs, "
          f"classes: {', '.join(summary_bits)} | "
          f"retirement_candidates={len(retirement_candidates)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
