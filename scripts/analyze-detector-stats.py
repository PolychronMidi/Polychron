#!/usr/bin/env python3
"""Analyze output/metrics/detector-stats.jsonl — surface dead phrase
lists, firing patterns, and coverage gaps in the stop-hook detectors.

Each detector that writes telemetry (psycho_stop, early_stop, etc.)
appends a row per fire with `detector`, `verdict`, and `detail`. Over
time, phrases in the detail string reveal which regex / phrase-list
entries are load-bearing vs decorative.

Output: a markdown table by detector showing fire-counts per verdict
plus the top-3 detail strings. Used both as an operator command
(run ad-hoc) and as input to a selftest probe.

Usage:
  python3 scripts/analyze-detector-stats.py              # summary
  python3 scripts/analyze-detector-stats.py --coverage   # phrase coverage
  python3 scripts/analyze-detector-stats.py --json       # machine-readable
"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path


_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_STATS = os.path.join(_PROJECT_ROOT, "output", "metrics", "detector-stats.jsonl")


def _load_rows() -> list[dict]:
    if not os.path.isfile(_STATS):
        return []
    rows = []
    with open(_STATS, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def summary(rows: list[dict]) -> str:
    if not rows:
        return "detector-stats: no telemetry yet (run some stop-hook cycles first)"
    by_detector: dict[str, Counter] = defaultdict(Counter)
    details: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        d = r.get("detector", "?")
        v = r.get("verdict", "?")
        by_detector[d][v] += 1
        details[d][str(r.get("detail", ""))[:80]] += 1
    lines = ["# Detector telemetry summary", "", f"Source: `{os.path.relpath(_STATS, _PROJECT_ROOT)}` ({len(rows)} rows)", ""]
    for detector in sorted(by_detector):
        lines.append(f"## `{detector}`")
        counts = by_detector[detector]
        total = sum(counts.values())
        for verdict, n in counts.most_common():
            pct = round(100 * n / total)
            lines.append(f"  - `{verdict}`: {n} ({pct}%)")
        top_details = details[detector].most_common(3)
        if top_details:
            lines.append("  - top details:")
            for detail, n in top_details:
                detail_show = detail or "(empty)"
                lines.append(f"    - {n}× `{detail_show}`")
        lines.append("")
    return "\n".join(lines)


def coverage_audit(rows: list[dict]) -> dict:
    """Compare early_stop's known phrase lists against detail strings
    from live fires — surface phrases that NEVER fired (dead weight) and
    fires whose detail doesn't reference any known phrase (phrase-list
    gap). Returns dict with 'never_fired' + 'unknown_details'."""
    try:
        sys.path.insert(0, os.path.join(_PROJECT_ROOT, "tools", "HME", "scripts", "detectors"))
        from early_stop import OPEN_ENDED_PROMPTS, ENUMERATION_PHRASES
    except Exception as e:
        return {"error": f"could not load early_stop phrase lists: {e}"}
    all_phrases = set(OPEN_ENDED_PROMPTS) | set(ENUMERATION_PHRASES)
    fired_phrases: set[str] = set()
    unknown_details: list[str] = []
    for r in rows:
        if r.get("detector") != "early_stop":
            continue
        detail = str(r.get("detail", ""))
        matched_any = False
        for p in all_phrases:
            if repr(p) in detail or p in detail:
                fired_phrases.add(p)
                matched_any = True
        if r.get("verdict") == "early_stop" and not matched_any:
            unknown_details.append(detail[:120])
    never_fired = sorted(all_phrases - fired_phrases)
    return {
        "total_phrases": len(all_phrases),
        "fired_phrases": len(fired_phrases),
        "never_fired": never_fired,
        "never_fired_count": len(never_fired),
        "unknown_details": unknown_details[:10],
    }


def main() -> int:
    rows = _load_rows()
    args = sys.argv[1:]
    if "--json" in args:
        out = {"summary_rows": len(rows), "by_detector": {}, "coverage": coverage_audit(rows)}
        by_detector: dict[str, Counter] = defaultdict(Counter)
        for r in rows:
            by_detector[r.get("detector", "?")][r.get("verdict", "?")] += 1
        out["by_detector"] = {d: dict(c) for d, c in by_detector.items()}
        print(json.dumps(out, indent=2))
        return 0
    if "--coverage" in args:
        audit = coverage_audit(rows)
        if audit.get("error"):
            print(audit["error"])
            return 1
        print(f"# early_stop phrase-list coverage\n")
        print(f"- total phrases registered: {audit['total_phrases']}")
        print(f"- phrases that have fired: {audit['fired_phrases']}")
        print(f"- phrases never fired: {audit['never_fired_count']}")
        if audit["never_fired"]:
            print(f"\nNever-fired phrases (candidates for retirement):")
            for p in audit["never_fired"][:20]:
                print(f"  - {p!r}")
        if audit["unknown_details"]:
            print(f"\nFires whose detail didn't match any known phrase (gap):")
            for d in audit["unknown_details"]:
                print(f"  - {d}")
        return 0
    print(summary(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
