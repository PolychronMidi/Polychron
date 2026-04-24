#!/usr/bin/env python3
"""Self-improvement scout — agent-facing hook/invariant proposer.

Scans recent activity + hook-latency + detector stats for RECURRING
patterns that could be formalized as new hooks, invariants, or
detector rules. Emits proposals to
`output/metrics/hme-self-improvement-proposals.jsonl` — each proposal
is a JSON object the agent can read and decide whether to accept.

Closing the bootstrapping loop: the system scans its own traces,
surfaces patterns, proposes infrastructure. The agent reviews and
implements. The new infrastructure becomes part of what future scouts
scan.

MVP pattern detectors:

1. **Recurring warning signature** — same `[foo] CRITICAL ...`
   message ≥ 5x in hme-errors.log over last 7 days → propose
   detector-level gate or root-cause invariant.

2. **Tool-pair co-firings** — Bash:{X} often followed by Edit:{same file}
   ≥ 10x → propose a proxy middleware that auto-injects read context
   for that Bash-then-Edit pair.

3. **Slow-hook outliers** — hook with sustained p95 > 2× median of
   other hooks → propose a performance invariant.

Each proposal includes: `pattern`, `evidence_count`, `first_seen`,
`last_seen`, `suggested_action`, `estimated_leverage` (high/medium/low).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parent.parent.parent.parent)
ERRORS_LOG = ROOT / "log" / "hme-errors.log"
LATENCY_LOG = ROOT / "log" / "hme-hook-latency.jsonl"
OUT = ROOT / "output" / "metrics" / "hme-self-improvement-proposals.jsonl"


_ERR_TS_RE = re.compile(r"\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]")
_ERR_SIG_RE = re.compile(r"\]\s*(\[[^\]]+\])\s*")  # bracket-tag after timestamp


def _recurring_warnings(min_count: int = 5) -> list[dict]:
    if not ERRORS_LOG.is_file():
        return []
    sig_to_lines: dict[str, list[str]] = defaultdict(list)
    for raw in ERRORS_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
        if not raw.strip():
            continue
        # Normalize numeric tails: "streak=31" → "streak=N"
        sig = re.sub(r'(streak|rc|age)=\d+', r'\1=N', raw)
        sig = re.sub(r'\[\d{4}-\d{2}-\d{2}T[\d:.]+Z?\]\s*', '', sig)
        sig_to_lines[sig].append(raw)
    proposals = []
    for sig, lines in sig_to_lines.items():
        if len(lines) < min_count:
            continue
        first, last = lines[0], lines[-1]
        proposals.append({
            "pattern": "recurring_warning",
            "signature": sig[:120],
            "evidence_count": len(lines),
            "first_seen_sample": first[:120],
            "last_seen_sample": last[:120],
            "suggested_action": "Formalize as detector/invariant — if this warning always fires with the same class, its root cause is a stable pattern; either auto-fix, suppress, or escalate to a class-A gate.",
            "estimated_leverage": "high" if len(lines) > 20 else "medium",
        })
    return proposals


def _slow_hook_outliers() -> list[dict]:
    if not LATENCY_LOG.is_file():
        return []
    by_hook: dict[str, list[int]] = defaultdict(list)
    for raw in LATENCY_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
        if not raw.strip():
            continue
        try:
            e = json.loads(raw)
        except json.JSONDecodeError:
            continue
        h, d = e.get("hook"), e.get("duration_ms")
        if isinstance(h, str) and isinstance(d, (int, float)):
            by_hook[h].append(int(d))
    medians = {}
    for h, arr in by_hook.items():
        if len(arr) < 10:
            continue
        arr_s = sorted(arr)
        medians[h] = arr_s[len(arr_s) // 2]
    if not medians:
        return []
    global_median = sorted(medians.values())[len(medians) // 2] or 1
    proposals = []
    for h, med in medians.items():
        if med > 2 * global_median and med > 100:
            p95 = sorted(by_hook[h])[int(len(by_hook[h]) * 0.95)]
            proposals.append({
                "pattern": "slow_hook_outlier",
                "hook": h,
                "median_ms": med,
                "p95_ms": p95,
                "global_median_ms": global_median,
                "suggested_action": f"Profile {h} — its latency is ≥2× global median. Consider splitting, caching, or moving work to a background thread.",
                "estimated_leverage": "medium",
            })
    return proposals


def _tool_pair_cofiring(min_count: int = 10) -> list[dict]:
    """Walks hook-latency log in order, detects X-then-Y pairs where X
    and Y happen close in time (same turn). Fragile — real coupling
    detection would need transcript analysis; MVP uses latency-log
    proximity."""
    if not LATENCY_LOG.is_file():
        return []
    events = []
    for raw in LATENCY_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
        if not raw.strip():
            continue
        try:
            e = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if "hook" in e and "ts" in e:
            events.append(e)
    events.sort(key=lambda e: e.get("ts", 0))
    pair_counts: Counter = Counter()
    prev = None
    for e in events:
        if prev and (e["ts"] - prev["ts"]) < 5:  # within 5s = likely same turn
            pair = (prev["hook"], e["hook"])
            pair_counts[pair] += 1
        prev = e
    proposals = []
    for pair, n in pair_counts.most_common(10):
        if n < min_count:
            continue
        proposals.append({
            "pattern": "tool_pair_cofiring",
            "a": pair[0],
            "b": pair[1],
            "count": n,
            "suggested_action": f"Hooks {pair[0]} → {pair[1]} co-fire {n}x. If one is enrichment and the other is action, consider fusing them (single proxy middleware that does both) to reduce hop count.",
            "estimated_leverage": "low" if n < 25 else "medium",
        })
    return proposals


def main() -> int:
    proposals = []
    proposals.extend(_recurring_warnings())
    proposals.extend(_slow_hook_outliers())
    proposals.extend(_tool_pair_cofiring())

    OUT.parent.mkdir(parents=True, exist_ok=True)
    ts = int(time.time())
    with open(OUT, "a") as f:
        for p in proposals:
            p["ts"] = ts
            f.write(json.dumps(p) + "\n")

    print(f"self-improvement-scout: {len(proposals)} proposal(s) written to {OUT.relative_to(ROOT)}")
    for p in proposals[:10]:
        tag = p.get("pattern", "?")
        key = p.get("signature") or p.get("hook") or f"{p.get('a')}→{p.get('b')}" or "?"
        lev = p.get("estimated_leverage", "?")
        print(f"  [{tag}] [{lev}] {str(key)[:80]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
