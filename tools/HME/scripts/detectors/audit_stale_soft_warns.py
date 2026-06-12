#!/usr/bin/env python3
"""Surface detectors stuck in `deny: false` with a `_note` mentioning promotion.

Soft-warned detectors (deny=false) often carry a `_note` field saying "softened
on YYYY-MM-DD" or "flip after one stable cycle". Without periodic review these
notes rot and detectors stay soft forever, defeating the safety-net intent.

This script surfaces:
  - any registry entry with deny=false AND _note mentioning soften/softened/promote/flip
  - the age (in days) of the note based on dates embedded in the note text

Run periodically (e.g. weekly) or on demand. Exit 0 always; output is advisory.

Usage: audit_stale_soft_warns.py [--max-age-days N]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])
_REGISTRY = _PROJECT / "tools" / "HME" / "scripts" / "detectors" / "registry.json"

_DATE_RE = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})")
_PROMOTE_KEYWORDS = ("soften", "softened", "promote", "flip", "after one stable",
                     "after stable", "warn-only", "soft-flag", "soft warn")
_NON_TEMPORAL_EXEMPTION = "auditor exemption: non-temporal"


def _embedded_date(note: str) -> date | None:
    m = _DATE_RE.search(note)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-age-days", type=int, default=14,
                        help="surface notes older than this (default 14)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    try:
        reg = json.loads(_REGISTRY.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        sys.stderr.write(f"audit_stale_soft_warns: registry read failed: {e}\n")
        return 0

    today = date.today()
    findings = []
    for d in reg.get("detectors", []):
        if d.get("deny") is not False:
            continue
        note = d.get("_note") or ""
        if not note:
            continue
        if not any(kw in note.lower() for kw in _PROMOTE_KEYWORDS):
            continue
        if _NON_TEMPORAL_EXEMPTION in note.lower():
            continue
        embedded = _embedded_date(note)
        age = (today - embedded).days if embedded else None
        flag = age is None or age > args.max_age_days
        if flag:
            findings.append({
                "name": d.get("name"),
                "bash_var": d.get("bash_var"),
                "age_days": age,
                "note": note,
            })

    if args.json:
        print(json.dumps({"findings": findings, "max_age_days": args.max_age_days}, indent=2))
        return 0

    if not findings:
        print(f"audit_stale_soft_warns: 0 stale soft-warn detectors (threshold: {args.max_age_days}d)")
        return 0

    print(f"audit_stale_soft_warns: {len(findings)} soft-warn detector(s) need review:")
    for f in findings:
        age = f"{f['age_days']}d" if f["age_days"] is not None else "no-date"
        print(f"  - {f['name']} (deny=false, age={age}): {f['note'][:120]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
