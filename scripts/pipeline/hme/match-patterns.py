#!/usr/bin/env python3
"""Arc II: Pattern Registry matcher.

Loads every JSON under tools/HME/patterns/, evaluates each pattern's trigger
against the current state of the measurement substrate, and writes
metrics/hme-pattern-matches.json listing which patterns currently match and
what action each recommends.

This is the shift from "agent proposes ad-hoc suggestions each round" to
"patterns are declarative triggers; the agent picks up whatever the triggers
fire on." Over time, the agent's role becomes less about GENERATING
suggestions and more about EXECUTING pattern-matched actions.

Non-fatal. Runs as POST_COMPOSITION step.
"""
from __future__ import annotations
import glob
import json
import os
import subprocess
import sys
import time

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PATTERNS_DIR = os.path.join(PROJECT_ROOT, "tools", "HME", "patterns")
OUT_PATH = os.path.join(PROJECT_ROOT, "metrics", "hme-pattern-matches.json")


def _load_patterns() -> list[dict]:
    out = []
    for path in sorted(glob.glob(os.path.join(PATTERNS_DIR, "*.json"))):
        try:
            with open(path, encoding="utf-8") as f:
                p = json.load(f)
            p["_file"] = os.path.relpath(path, PROJECT_ROOT)
            out.append(p)
        except Exception as e:
            print(f"match-patterns: skip {path}: {type(e).__name__}: {e}", file=sys.stderr)
    return out


def _eval_trigger(pattern: dict) -> tuple[bool, str]:
    trigger = pattern.get("trigger") or {}
    cmd = trigger.get("check")
    if not cmd:
        return (False, "no check command")
    try:
        r = subprocess.run(
            ["bash", "-c", cmd],
            cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=15,
            env={**os.environ, "PROJECT_ROOT": PROJECT_ROOT},
        )
    except subprocess.TimeoutExpired:
        return (False, "trigger check timeout")
    stdout = (r.stdout or "").strip()
    return (bool(stdout), stdout)


def main() -> int:
    patterns = _load_patterns()
    if not patterns:
        print("match-patterns: no patterns found in tools/HME/patterns/")
        return 0

    matches = []
    for p in patterns:
        hit, payload = _eval_trigger(p)
        if hit:
            matches.append({
                "id": p.get("id"),
                "category": p.get("category"),
                "description": p.get("description", "")[:200],
                "payload": payload,
                "action_summary": (p.get("action") or {}).get("summary", ""),
                "action_steps": (p.get("action") or {}).get("steps", []),
                "pattern_file": p.get("_file"),
            })

    result = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "patterns_total": len(patterns),
        "matches_count": len(matches),
        "matches": matches,
        "by_category": {},
    }
    for m in matches:
        k = m.get("category", "uncategorized")
        result["by_category"][k] = result["by_category"].get(k, 0) + 1

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")

    summary = ", ".join(f"{m['id']} ({m['category']})" for m in matches)
    print(f"match-patterns: {len(matches)}/{len(patterns)} matched"
          + (f"  [{summary}]" if matches else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
