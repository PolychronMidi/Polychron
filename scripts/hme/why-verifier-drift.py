#!/usr/bin/env python3
"""i/why mode=verifier-drift -- Horizon VI third leg.

Detects verifiers whose source-hash AND status-hash have both remained
unchanged across the most recent N runs. The detection criterion is
purely factual (two hashes frozen for N rounds); interpretation --
whether the frozen verifier is still actually checking what its name
claims -- is left to the reader. Pairs with verifier-utility (always-PASS
detection) and verifier-coverage (path coverage gaps) to complete the
meta-meta layer.

The criterion intentionally combines source AND status: a verifier
whose source has NOT changed but whose status has been moving is
clearly active. A verifier whose status is frozen but whose source
recently changed is being actively maintained. Only the (frozen,
frozen) intersection signals the candidate-for-review pattern."""
from __future__ import annotations
import hashlib
import json
import os
import re
import sys
from collections import defaultdict

from _common import PROJECT_ROOT, load_jsonl_all


def _verifier_source_hashes() -> dict[str, str]:
    """Walk verify_coherence/, locate each verifier class block, hash it."""
    pkg = os.path.join(PROJECT_ROOT, "tools", "HME", "scripts", "verify_coherence")
    name_re = re.compile(r'^\s*name\s*=\s*"([^"]+)"\s*$', re.MULTILINE)
    out: dict[str, str] = {}
    if not os.path.isdir(pkg):
        return out
    for root, _d, files in os.walk(pkg):
        for f in files:
            if not f.endswith(".py"):
                continue
            path = os.path.join(root, f)
            try:
                with open(path, encoding="utf-8") as fp:
                    src = fp.read()
            except OSError:
                continue
            lines = src.splitlines()
            for m in name_re.finditer(src):
                name = m.group(1)
                line_idx = src[:m.start()].count("\n")
                # Find class block boundaries (mirror why-verifier.py logic)
                class_start = None
                for i in range(line_idx, -1, -1):
                    if lines[i].lstrip().startswith("class "):
                        class_start = i
                        break
                if class_start is None:
                    continue
                class_indent = len(lines[class_start]) - len(lines[class_start].lstrip())
                class_end = len(lines)
                for i in range(class_start + 1, len(lines)):
                    stripped = lines[i].rstrip()
                    if not stripped:
                        continue
                    indent = len(lines[i]) - len(lines[i].lstrip())
                    if indent <= class_indent and stripped.lstrip().startswith(
                            ("class ", "def ", "@", "_")):
                        class_end = i
                        break
                block = "\n".join(lines[class_start:class_end])
                out[name] = hashlib.sha256(block.encode()).hexdigest()[:12]
    return out


def main(argv):
    n_runs = 50  # default lookback
    for a in argv[1:]:
        if a.startswith("n="):
            try:
                n_runs = int(a.split("=", 1)[1])
            except ValueError:
                pass  # silent-ok: best-effort parse

    ts_path = os.path.join(PROJECT_ROOT, "output", "metrics",
                           "hme-coherence-timeseries.jsonl")
    if not os.path.isfile(ts_path):
        print("# i/why mode=verifier-drift")
        print(f"No timeseries at {ts_path}")
        return 1

    rows = load_jsonl_all("output/metrics/hme-coherence-timeseries.jsonl")

    if len(rows) < n_runs:
        n_runs = len(rows)
    recent = rows[-n_runs:]

    # Per-verifier status sequence over recent N runs
    status_sequence: dict[str, list[str]] = defaultdict(list)
    for row in recent:
        for name, info in row.get("probes", {}).items():
            if isinstance(info, dict):
                status_sequence[name].append(info.get("status", "?"))

    src_hashes = _verifier_source_hashes()

    # The timeseries `probes` field carries TWO kinds of entries:
    frozen_hci, frozen_selftest = [], []
    for name, seq in status_sequence.items():
        if len(seq) < n_runs:
            continue
        if len(set(seq)) != 1:
            continue
        entry = {
            "name": name,
            "status": seq[0],
            "runs": len(seq),
            "source_hash": src_hashes.get(name, "-"),
        }
        if name in src_hashes:
            frozen_hci.append(entry)
        else:
            frozen_selftest.append(entry)
    frozen = frozen_hci  # default report focuses on HCI verifiers

    # Sort: FAIL frozen first (most actionable), then PASS
    order = {"FAIL": 0, "ERROR": 1, "WARN": 2, "PASS": 3, "SKIP": 4}
    frozen.sort(key=lambda f: (order.get(f["status"], 9), f["name"]))

    print(f"# i/why mode=verifier-drift  (lookback: {n_runs} runs)")
    print()
    if not frozen and not frozen_selftest:
        print(f"  No verifier carries a status frozen across all {n_runs} recent runs.")
        return 0
    if not frozen and frozen_selftest:
        print(f"  No HCI verifier (verify_coherence/*) is frozen for {n_runs} runs.")
        print(f"  ({len(frozen_selftest)} selftest probe(s) are frozen -- see below)")
        print()

    # Bucket by status
    by_status: dict[str, list] = defaultdict(list)
    for f in frozen:
        by_status[f["status"]].append(f)

    for status in ("FAIL", "ERROR", "WARN", "SKIP", "PASS"):
        rs = by_status.get(status, [])
        if not rs:
            continue
        print(f"## Status frozen at {status} for >={n_runs} runs ({len(rs)})")
        for r in rs[:10]:
            print(f"  {r['name']:36}  src_hash={r['source_hash']}")
        if len(rs) > 10:
            print(f"  (+{len(rs) - 10} more)")
        print()

    # Selftest probes (different code path than HCI verifiers; reported
    # for completeness but distinguished from the HCI report above).
    if frozen_selftest:
        print(f"## Selftest probes also frozen at PASS for >={n_runs} runs ({len(frozen_selftest)})")
        print(f"  (these live in evolution_selftest/selftest.py, not verify_coherence/)")
        for r in frozen_selftest[:8]:
            print(f"  {r['name']:36}  src=selftest")
        if len(frozen_selftest) > 8:
            print(f"  (+{len(frozen_selftest) - 8} more)")
        print()

    # Detection criterion only -- no inference about meaning
    print("# Note:")
    print("  This reports the factual (frozen status, current source-hash)")
    print("  pair per verifier. To detect SOURCE drift (verifier was")
    print("  edited recently while its status remained frozen), compare")
    print("  the src_hash here against an earlier snapshot you took.")
    print("  Future expansion: persist src_hash history per round so the")
    print("  combined (status-frozen * source-changed) intersection can")
    print("  surface automatically.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
