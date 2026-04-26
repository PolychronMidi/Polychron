#!/usr/bin/env python3
"""i/why <invariant-id> — explain an invariant's state.

Reads: hme-invariant-history.json (current state, streak), hme-invariant-efficacy.json
(class + citation count + role), and git log for recent commit references.
"""
from __future__ import annotations
import subprocess
import sys

from _common import PROJECT_ROOT, METRICS_DIR, load_json as _load


def main(argv):
    if len(argv) < 2:
        # Surface available invariant IDs instead of just printing usage
        # — the user has no way to discover valid IDs otherwise.
        eff = _load("output/metrics/hme-invariant-efficacy.json") or {}
        ids = sorted((eff.get("per_invariant") or {}).keys())
        print("Usage: i/why <invariant-id>", file=sys.stderr)
        if ids:
            print(f"\nAvailable invariants ({len(ids)}):", file=sys.stderr)
            for inv_id in ids[:30]:
                print(f"  {inv_id}", file=sys.stderr)
            if len(ids) > 30:
                print(f"  ... +{len(ids) - 30} more", file=sys.stderr)
        else:
            print("  (no efficacy report found at output/metrics/hme-invariant-efficacy.json — run pipeline first)",
                  file=sys.stderr)
        return 2
    inv_id = argv[1]

    hist = _load("output/metrics/hme-invariant-history.json") or {}
    eff = _load("output/metrics/hme-invariant-efficacy.json") or {}
    per_inv = eff.get("per_invariant", {}).get(inv_id)
    if not per_inv:
        # Suggest near-matches when the user typo'd an ID.
        all_ids = sorted((eff.get("per_invariant") or {}).keys())
        from difflib import get_close_matches
        suggestions = get_close_matches(inv_id, all_ids, n=3, cutoff=0.6)
        msg = f"invariant '{inv_id}' not found in efficacy report"
        if suggestions:
            msg += f"\n  did you mean: {', '.join(suggestions)}?"
        print(msg, file=sys.stderr)
        return 1

    streak = hist.get("fail_streaks", {}).get(inv_id, 0)
    last = hist.get("last_result", {}).get(inv_id, "unknown")
    klass = per_inv.get("class", "?")
    cites = per_inv.get("commits_citing", 0)
    severity = per_inv.get("severity", "?")
    efficacy = per_inv.get("efficacy", 0)

    # Pull config definition
    inv_cfg = _load("tools/HME/config/invariants.json") or {}
    defn = None
    for i in inv_cfg.get("invariants", []):
        if i.get("id") == inv_id:
            defn = i
            break

    # Class-to-meaning map for readers unfamiliar with Arc IV taxonomy.
    _CLASS_GLOSS = {
        "load-bearing": "actively cited in fix commits — removing this would hide real regressions",
        "load-bearing-historical": "cited in fix commits within the last 90 days but quiet recently",
        "structural": "never-failing sanity check; hard to regress against",
        "decorative": "never-failing; no fix-commit citations ever — ornamental",
        "flappy": "fires repeatedly without being cited in fix commits — candidate for retirement",
    }
    klass_gloss = _CLASS_GLOSS.get(klass, "")

    print(f"{inv_id}")
    print(f"  class={klass}" + (f"  ({klass_gloss})" if klass_gloss else ""))
    print(f"  severity={severity}  efficacy={efficacy}  (efficacy = fix-commit citations / fails; 1.0 = every fail fixed)")
    print(f"  last_result={last}  fail_streak={streak}" + (" consecutive rounds" if streak else ""))
    print(f"  commits_citing: {cites}")
    if defn:
        print(f"  type: {defn.get('type')}")
        desc = defn.get("description", "")
        if desc:
            print(f"  description: {desc[:300]}")
        born = defn.get("born_from")
        if born:
            print(f"  born_from: {born}")
    # Recent git log snippets
    try:
        log = subprocess.check_output(
            ["git", "log", "-30", "--grep", inv_id, "--pretty=%h %s"],
            cwd=PROJECT_ROOT, timeout=10, text=True,
        ).strip()
        if log:
            print("  recent commits citing this id:")
            for line in log.split("\n")[:5]:
                print(f"    {line}")
    except Exception:
        pass
    # Retirement candidate?
    if inv_id in (eff.get("retirement_candidates") or []):
        print("  STATUS: retirement candidate (Arc IV)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
