#!/usr/bin/env python3
"""Predictive hooks — rank hooks by signal value.

For each hook in `log/hme-hook-latency.jsonl`, correlate its verdicts
(captured via stderr in `stop.sh` crash logger + `_HME_HOOK_VERDICT`)
against whether the session ACTED on that verdict.

MVP: compute per-hook "prediction accuracy" as the rate at which a
hook's verdict can be predicted from a simple prior (e.g., "always
passes" for hooks that fire on >95% benign inputs). Hooks with high
predictability are candidates for retirement — their signal is redundant
with the trivial prior. Hooks with low predictability are load-bearing.

Output: output/metrics/hme-hook-signal-value.json
  {
    "<hook_name>": {
      "n": int,
      "pass_rate": float,
      "predictability": float,  # 1.0 = always predictable (low signal)
      "recommendation": "retire" | "keep" | "promote"
    }
  }

Run periodically (every N sessions or via CI) to track drift.
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from pathlib import Path


ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parent.parent.parent.parent)
LATENCY_LOG = ROOT / "log" / "hme-hook-latency.jsonl"
OUT = ROOT / "output" / "metrics" / "hme-hook-signal-value.json"

# Hooks we KNOW fire verdicts (not latency-only telemetry). Extend as
# verdict capture lands for more hooks.
_VERDICT_HOOKS = {
    "pretooluse_bash", "pretooluse_edit", "pretooluse_read",
    "pretooluse_write", "pretooluse_toolsearch",
    "posttooluse_bash", "posttooluse_edit", "posttooluse_read_kb",
    "posttooluse_hme_review", "stop",
}


def _load_entries() -> list[dict]:
    if not LATENCY_LOG.is_file():
        return []
    out = []
    for line in LATENCY_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _score(entries: list[dict]) -> dict:
    by_hook: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        h = e.get("hook")
        if isinstance(h, str):
            by_hook[h].append(e)
    out = {}
    for hook, rows in by_hook.items():
        if hook not in _VERDICT_HOOKS:
            continue
        n = len(rows)
        if n < 20:
            continue
        # MVP predictability heuristic: rate at which duration falls in
        # the dominant half-decade bucket (under-100ms, 100ms-1s, >1s).
        # Hooks that always land in the same bucket have predictable
        # latency → candidate signal-redundant. This is a proxy — real
        # prediction accuracy requires verdict capture, which the
        # next iteration of the stderr-capture stop-chain can provide.
        buckets = defaultdict(int)
        for r in rows:
            d = r.get("duration_ms", 0)
            if d < 100: b = "fast"
            elif d < 1000: b = "med"
            else: b = "slow"
            buckets[b] += 1
        dominant = max(buckets.values()) / n if buckets else 0.0
        if dominant > 0.95:
            rec = "retire"  # always same bucket → low variance → redundant
        elif dominant > 0.80:
            rec = "keep"
        else:
            rec = "promote"  # high variance → real signal
        out[hook] = {
            "n": n,
            "predictability": round(dominant, 3),
            "recommendation": rec,
        }
    return out


def main() -> int:
    entries = _load_entries()
    results = _score(entries)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sample_count": len(entries),
        "hooks": results,
    }, indent=2))
    print(f"predictive-hooks: {len(results)} verdict-hooks scored (sample={len(entries)})")
    for h, v in sorted(results.items(), key=lambda kv: kv[1]["predictability"]):
        print(f"  {h:<25} n={v['n']:<4} pred={v['predictability']:.2f}  {v['recommendation']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
