#!/usr/bin/env python3
"""i/why mode=verifier-utility -- Horizon VI seed (meta-meta verifiers).

Reads the per-verifier status history from
output/metrics/hme-coherence-timeseries.jsonl and computes
signal-to-noise per verifier:
  - always-PASS (no information ever)
  - always-FAIL (broken or alarmist)
  - flip count (how often did status change)
  - score variance (how noisy is the score)
  - last-status (what is it now)

Surfaces verifiers that are likely candidates for pruning, retuning,
or attention. The full Horizon VI vision adds: incident-correlation
("did this verifier's FAIL catch a real bug, or did the agent ignore
it?"), coverage gaps, drift detection ("a verifier that passed for
100 runs may no longer be checking what it used to"). Today this
ships the cheapest of those four -- and demonstrates the horizon is
actually within reach.
"""
from __future__ import annotations
import json
import os
import sys
from collections import defaultdict

from _common import PROJECT_ROOT, load_jsonl_all


def main(argv):
    verbose = any(
        a in ("verbose=true", "--verbose", "-v")
        for a in argv[1:]
    )
    ts_path = os.path.join(PROJECT_ROOT, "output", "metrics",
                           "hme-coherence-timeseries.jsonl")
    if not os.path.isfile(ts_path):
        print("# i/why mode=verifier-utility")
        print(f"No timeseries at {ts_path}")
        return 1

    # Pull subtag map from REGISTRY (not stored in snapshot history).
    name_to_subtag: dict[str, str] = {}
    try:
        sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "scripts"))
        from verify_coherence import REGISTRY  # type: ignore
        for v in REGISTRY:
            name_to_subtag[v.name] = getattr(v, "subtag", "(none)")
    except Exception:
        pass  # silent-ok: diagnostic; failure non-fatal

    rows = load_jsonl_all("output/metrics/hme-coherence-timeseries.jsonl")

    # Per-verifier history: name -> list of (status, score)
    history: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for row in rows:
        for name, info in row.get("probes", {}).items():
            if isinstance(info, dict):
                history[name].append(
                    (info.get("status", "?"), info.get("score", 0.0))
                )

    if not history:
        print("# i/why mode=verifier-utility")
        print(f"No per-verifier data in {len(rows)} timeseries rows.")
        return 0

    # Compute utility metrics per verifier
    metrics = []
    for name, runs in history.items():
        n = len(runs)
        statuses = [s for s, _ in runs]
        scores = [v for _, v in runs]
        n_pass = statuses.count("PASS")
        n_fail = statuses.count("FAIL")
        # Flip count: status transitions
        flips = sum(
            1 for i in range(1, n) if statuses[i] != statuses[i - 1]
        )
        # Score variance (population)
        if scores:
            mean = sum(scores) / len(scores)
            var = sum((s - mean) ** 2 for s in scores) / len(scores)
        else:
            var = 0.0
        last = statuses[-1] if statuses else "?"
        metrics.append({
            "name": name, "n": n, "pass": n_pass, "fail": n_fail,
            "flips": flips, "var": var, "last": last,
        })

    print(f"# i/why mode=verifier-utility ({len(rows)} runs analyzed)")
    print()

    cap = 999 if verbose else 8

    def _fmt_row(m: dict, extra: str) -> str:
        subtag = name_to_subtag.get(m["name"], "(none)")
        return f"  {m['name']:36}  {subtag:24}  {extra}"

    # Bucket 1: always-PASS verifiers (zero information ever)
    always_pass = [m for m in metrics if m["pass"] == m["n"] and m["n"] >= 10]
    if always_pass:
        always_pass.sort(key=lambda m: -m["n"])
        print(f"## Always-PASS ({len(always_pass)}) -- zero information ever; candidates for downweighting")
        for m in always_pass[:cap]:
            print(_fmt_row(m, f"{m['n']} runs, never flipped"))
        if len(always_pass) > cap:
            print(f"  (+{len(always_pass) - cap} more -- pass verbose=true to show)")
        print()
        # persist auto-prune marker so downstream
        try:
            import time as _time
            prune_path = os.path.join(PROJECT_ROOT, "tmp", "hme-verifier-prune.json")
            tmp_path = prune_path + ".tmp"
            payload = {
                "ts": _time.time(),
                "rationale": "verifiers passing for >=10 consecutive runs without flipping carry zero information",
                "weight_multiplier": 0.5,
                "candidates": [
                    {"name": m["name"], "runs": m["n"], "subtag": name_to_subtag.get(m["name"], "(none)")}
                    for m in always_pass
                ],
            }
            with open(tmp_path, "w") as _pf:
                json.dump(payload, _pf, indent=2)
            os.replace(tmp_path, prune_path)
            print(f"  Persisted auto-prune marker: tmp/hme-verifier-prune.json (advisory)")
            print()
        except OSError as _err:
            # Marker write is advisory; don't fail the analysis on
            # filesystem hiccups, but surface the diagnostic.
            print(f"  (auto-prune marker write failed: {_err})")
            print()

    # Bucket 2: always-FAIL (broken or signal we ignore)
    always_fail = [m for m in metrics if m["fail"] == m["n"] and m["n"] >= 10]
    if always_fail:
        print(f"## Always-FAIL ({len(always_fail)}) -- broken, alarmist, or chronically ignored")
        for m in always_fail[:cap]:
            print(_fmt_row(m, f"{m['n']} runs, all FAIL"))
        if len(always_fail) > cap:
            print(f"  (+{len(always_fail) - cap} more -- pass verbose=true to show)")
        print()

    # Bucket 3: flapping -- high flip rate signals noise or genuine instability
    flappers = [
        m for m in metrics
        if m["n"] >= 10 and m["flips"] >= max(3, m["n"] * 0.15)
    ]
    flappers.sort(key=lambda m: -m["flips"])
    if flappers:
        print(f"## Flapping ({len(flappers)}) -- flips >=15% of runs; either noisy or catching real instability")
        for m in flappers[:cap]:
            rate = m["flips"] / m["n"] * 100
            print(_fmt_row(m, f"{m['flips']}/{m['n']} flips ({rate:.0f}%) . last={m['last']}"))
        if len(flappers) > cap:
            print(f"  (+{len(flappers) - cap} more -- pass verbose=true to show)")
        print()

    # Bucket 4: high score variance (mode oscillating even when status stable)
    variant = [m for m in metrics if m["n"] >= 10 and m["var"] > 0.02]
    variant.sort(key=lambda m: -m["var"])
    if variant:
        cap2 = 999 if verbose else 5
        print(f"## High score variance ({len(variant)}) -- score oscillates even when status doesn't")
        for m in variant[:cap2]:
            print(_fmt_row(m, f"var={m['var']:.3f} . last={m['last']}"))
        if len(variant) > cap2:
            print(f"  (+{len(variant) - cap2} more -- pass verbose=true to show)")
        print()

    # Summary
    total = len(metrics)
    silent = len(always_pass) + len(always_fail)
    active = total - silent - len(flappers)
    print(f"## Summary")
    print(f"  total verifiers tracked: {total}")
    print(f"  silent (always same status): {silent}")
    print(f"  flapping: {len(flappers)}")
    print(f"  active stable: {active}")
    print()
    # Incident-correlation heuristic (Horizon VI asymptote): walk the
    try:
        sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "service"))
        from direct_lance import _open_table  # type: ignore
        table = _open_table()
        if table is not None:
            wanted = ["title", "content", "category"]
            if hasattr(table, "to_arrow"):
                arr = table.to_arrow()
                cols = [c for c in wanted if c in arr.column_names]
                df = arr.select(cols).to_pandas()
            else:
                df = table.to_pandas()[wanted]
            verifier_names = {m["name"] for m in metrics}
            incident_hits = defaultdict(int)
            for _, row in df.iterrows():
                cat = str(row.get("category", ""))
                if cat not in ("bugfix", "fix"):
                    continue
                content = str(row.get("content", "")).lower()
                title = str(row.get("title", "")).lower()
                full = content + " " + title
                for name in verifier_names:
                    if name.lower() in full:
                        incident_hits[name] += 1
            if incident_hits:
                print("## Incident-correlation (heuristic)")
                print("  Verifiers mentioned by name in KB bugfix/fix entries --")
                print("  weak-signal proof the verifier has helped surface real bugs.")
                ranked = sorted(incident_hits.items(), key=lambda kv: -kv[1])
                for name, count in ranked[:5]:
                    print(f"  {name:36}  {count} mention(s) in fix/bugfix entries")
                print()
    except Exception:
        pass  # silent-ok: diagnostic; failure non-fatal

    print("# Next:")
    print("  i/why mode=verifier <name>     drill into one verifier (status + history + source)")
    print("  i/status mode=hci-by-subtag    aggregate by category")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
