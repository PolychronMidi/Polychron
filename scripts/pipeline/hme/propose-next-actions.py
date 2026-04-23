#!/usr/bin/env python3
"""Emergent behavior harvester — the fifth behavior of the four arcs.

Reads outputs from all four observability arcs and synthesizes a prioritized
action queue. This is the data-driven replacement for "agent proposes 10
ad-hoc tactical suggestions each round." When the substrate has captured
enough signal, the action queue writes itself.

Sources:
  Arc I:    metrics/hme-consensus.json           (outlier voters)
  Arc II:   metrics/hme-pattern-matches.json     (matched patterns + actions)
  Arc III:  metrics/hme-legendary-drift.json     (drift outliers + z-scores)
  Arc IV:   metrics/hme-invariant-efficacy.json  (flappy + retirement candidates)

Priority ordering:
  1. Matched patterns   (Arc II — most actionable; each has prescribed steps)
  2. Drift outliers     (Arc III — preemptive state drift)
  3. Consensus outliers (Arc I — substrate disagreement)
  4. Retirement cands   (Arc IV — flappy invariant cleanup)

Writes metrics/hme-next-actions.json. Empty actions list means the substrate
reports "nothing to do" — a healthy quiescent state.

Non-fatal. Runs POST_COMPOSITION after all four arcs.
"""
from __future__ import annotations
import json
import os
import sys
import time

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
METRICS_DIR = os.path.join(PROJECT_ROOT, "output", "metrics")
OUT = os.path.join(METRICS_DIR, "hme-next-actions.json")


def _load(p):
    try:
        with open(os.path.join(PROJECT_ROOT, p), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def main() -> int:
    actions: list[dict] = []

    # R25 #5: expected_defer_rounds per pattern category — distinguishes
    # "agent correctly waiting" from "agent ignoring."
    DEFER_ROUNDS_BY_CATEGORY = {
        "decision_gate": 3,   # wait-and-watch patterns (accept-regime-shift)
        "investigation": 1,   # should investigate next round
        "retirement": 2,      # confirm 2 rounds before removing
        "validation": 1,
    }

    # Arc II: matched patterns (highest priority — each carries prescribed steps)
    matches = _load(os.path.join(METRICS_DIR, "hme-pattern-matches.json")) or {}
    for m in matches.get("matches", []):
        cat = m.get("category")
        actions.append({
            "priority": 1,
            "source": "arc_ii_pattern",
            "id": m.get("id"),
            "category": cat,
            "summary": m.get("action_summary"),
            "detail": f"trigger payload: {m.get('payload', '')[:200]}",
            "steps": m.get("action_steps", []),
            "expected_defer_rounds": DEFER_ROUNDS_BY_CATEGORY.get(cat, 1),
        })

    # Arc III: drift outliers (preemptive — catches state drift before verdict fails)
    drift = _load(os.path.join(METRICS_DIR, "hme-legendary-drift.json")) or {}
    if drift.get("status") == "drift_detected":
        for o in (drift.get("outliers") or [])[:5]:
            actions.append({
                "priority": 2,
                "source": "arc_iii_drift",
                "id": f"drift:{o.get('field')}",
                "category": "investigation",
                "summary": f"{o['field']} = {o['current']} (median {o['median']}, z={o['z_score']:+.2f})",
                "detail": "Legendary envelope deviation ≥2σ. Investigate trajectory vs single-round jump.",
                "steps": [
                    "Inspect historical trajectory via metrics/hme-legendary-states.jsonl",
                    "Categorize: sudden jump (anomaly) or slow drift (regime change)",
                    "If benign regime change: add precedent to pattern history",
                    "If degradation: identify compensating substrate OR add controller correction",
                ],
            })

    # Arc I: consensus outliers (substrates disagree)
    con = _load(os.path.join(METRICS_DIR, "hme-consensus.json")) or {}
    if con.get("divergence") in ("moderate", "high"):
        for o in con.get("outliers", []):
            actions.append({
                "priority": 3,
                "source": "arc_i_consensus",
                "id": f"consensus:{o.get('voter')}",
                "category": "investigation",
                "summary": f"{o['voter']} voter = {o['score']:+.2f} (delta {o['delta_from_mean']:+.2f} from mean {con.get('mean')})",
                "detail": f"Consensus divergence={con.get('divergence')} stdev={con.get('stdev')}.",
                "steps": [
                    f"Read the {o['voter']} voter's source metric",
                    "Check 3-round trend vs single-round blip",
                    "Decide: outlier is right (and majority blind) OR outlier broken (and majority correct)",
                ],
            })

    # Arc V: blindspots — subsystem coverage gaps. Lifted from observation-only
    # status surface into the action queue so "we haven't touched this subsystem
    # in N rounds" becomes a first-class proposal the agent can see + act on.
    # Priority is between drift (2) and consensus (3): stronger than a dissenting
    # voter, weaker than preemptive drift.
    bs = _load(os.path.join(METRICS_DIR, "hme-blindspots.json")) or {}
    for gap in (bs.get("dark_subsystems") or [])[:3]:
        sub = gap.get("subsystem") or gap.get("module") or gap.get("name")
        if not sub:
            continue
        rounds = gap.get("rounds_without_writes", gap.get("rounds", "?"))
        actions.append({
            "priority": 2,
            "source": "arc_v_blindspot",
            "id": f"blindspot:subsystem:{sub}",
            "category": "investigation",
            "summary": f"Subsystem '{sub}' has had no file_written events in {rounds} rounds — systemic avoidance",
            "detail": "Unseen subsystems are the darkest blindspot: we don't know what we don't know. Pick a module in this subsystem for next round's evolution.",
            "steps": [
                f"Read one representative module in src/{sub}/",
                f"i/trace target='{sub} subsystem' — map current coupling & caller landscape",
                f"Propose an evolution that exercises {sub} in the next round",
            ],
        })
    for orphan in (bs.get("uncovered_modules") or [])[:3]:
        mod = orphan.get("module") if isinstance(orphan, dict) else orphan
        if not mod:
            continue
        actions.append({
            "priority": 3,
            "source": "arc_v_blindspot",
            "id": f"blindspot:uncovered:{mod}",
            "category": "investigation",
            "summary": f"Module '{mod}' has zero KB coverage",
            "detail": "Edits to this module can't benefit from KB constraints — the KB is blind here.",
            "steps": [
                f"i/hme-read target={mod} mode=before — seeds KB via the staleness pass",
                f"i/learn title='{mod} purpose' content='...' category=architecture — capture first anchor",
            ],
        })

    # Arc IV: retirement candidates (flappy invariants accumulated without citation)
    eff = _load(os.path.join(METRICS_DIR, "hme-invariant-efficacy.json")) or {}
    for cand in eff.get("retirement_candidates", []):
        actions.append({
            "priority": 4,
            "source": "arc_iv_retirement",
            "id": f"retire:{cand}",
            "category": "retirement",
            "summary": f"Retire or recalibrate invariant: {cand}",
            "detail": "Classified as flappy — fires without any fix commit citing it. Either the signal is noise, or the threshold is wrong, or we've tolerated it too long.",
            "steps": [
                "Check fail_streak + last 10 runs via metrics/hme-invariant-history.json",
                "Decide: remove from invariants.json OR recalibrate threshold to reflect actual tolerance",
                "If removed, document precedent in tools/HME/patterns/retire-flappy-invariant.json",
            ],
        })

    # R24 #4 + R25 #5: track repeat-count across rounds. Only escalate once
    # repeat-count exceeds the pattern's expected_defer_rounds. A decision-gate
    # pattern with 3-round expected defer correctly waits 3 rounds without
    # being labeled "ignored"; at round 4 it's genuinely deferred too long.
    prev = _load(os.path.join(METRICS_DIR, "hme-next-actions.json")) or {}
    prev_actions_by_id = {
        a.get("id"): a for a in (prev.get("actions") or []) if a.get("id")
    }
    if prev_actions_by_id:
        try:
            import subprocess
            log = subprocess.check_output(
                ["git", "log", "-10", "--pretty=%s%n%b"],
                cwd=PROJECT_ROOT, timeout=5, text=True,
            )
        except Exception:
            log = ""
        for a in actions:
            prev_a = prev_actions_by_id.get(a["id"])
            if prev_a and a["id"].lower() not in log.lower():
                repeat = int(prev_a.get("repeat_count", 0)) + 1
                a["repeat_count"] = repeat
                a["repeated_from_previous_round"] = True
                # Only escalate when over the expected defer window
                expected = a.get("expected_defer_rounds", 1)
                if repeat > expected:
                    a["priority"] = max(1, a["priority"] - 1)
                    a["deferred_beyond_expected"] = True

    actions.sort(key=lambda a: a["priority"])

    # R24 #4: emit harvester_ignored if 3+ consecutive rounds have proposed
    # the same id without a commit citation.
    try:
        import subprocess
        log_long = subprocess.check_output(
            ["git", "log", "-30", "--pretty=%s%n%b"],
            cwd=PROJECT_ROOT, timeout=5, text=True,
        )
        # R25 #5: harvester_ignored fires only for DEFERRED_BEYOND_EXPECTED
        # actions (past their expected defer window) — not actions correctly
        # waiting per pattern-declared defer semantics.
        ignored = [a["id"] for a in actions
                   if a.get("deferred_beyond_expected")
                   and a["id"].lower() not in log_long.lower()]
        if ignored:
            try:
                subprocess.Popen([
                    "python3",
                    os.path.join(PROJECT_ROOT, "tools", "HME", "activity", "emit.py"),
                    "--event=harvester_ignored",
                    f"--count={len(ignored)}",
                    f"--ids={','.join(ignored)}",
                    "--session=pipeline",
                ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    env={**os.environ, "PROJECT_ROOT": PROJECT_ROOT})
            except Exception:
                pass
    except Exception:
        pass

    # Build a terse one-line summary for console output.
    bucket_counts = {"arc_ii_pattern": 0, "arc_iii_drift": 0,
                     "arc_i_consensus": 0, "arc_iv_retirement": 0}
    for a in actions:
        bucket_counts[a["source"]] = bucket_counts.get(a["source"], 0) + 1

    result = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_actions": len(actions),
        "by_source": bucket_counts,
        "actions": actions,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")

    if actions:
        bits = [f"{k.split('_')[1]}={v}" for k, v in bucket_counts.items() if v > 0]
        print(f"propose-next-actions: {len(actions)} actions queued  [{' '.join(bits)}]")
    else:
        print("propose-next-actions: 0 actions — substrate reports healthy quiescent state")
    return 0


if __name__ == "__main__":
    sys.exit(main())
