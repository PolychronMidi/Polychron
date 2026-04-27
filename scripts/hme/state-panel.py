#!/usr/bin/env python3
"""i/state — unified panel: every state machine in one ~15-line view.

Aggregates the 5+ state files an agent currently has to mentally
reconcile (onboarding, NEXUS lifecycle, pipeline lock, fingerprint
verdict, KB freshness, last activity).

Usage:
    i/state              # full panel (default)
    i/state mode=brief   # only the most-recent state of each
"""
from __future__ import annotations
import json
import os
import sys
import time

from _common import PROJECT_ROOT


def _read_text(path: str) -> str:
    if not os.path.isfile(path):
        return ""
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return ""


def _read_json(path: str) -> dict | None:
    if not os.path.isfile(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _age(path: str) -> str:
    if not os.path.isfile(path):
        return "(absent)"
    try:
        delta = time.time() - os.path.getmtime(path)
        if delta < 60:
            return f"{int(delta)}s ago"
        if delta < 3600:
            return f"{int(delta / 60)}m ago"
        if delta < 86400:
            return f"{int(delta / 3600)}h ago"
        return f"{int(delta / 86400)}d ago"
    except OSError:
        return "(unknown)"


def main(argv):
    brief = any(a == "mode=brief" for a in argv[1:])

    out = ["# HME state panel"]

    # 1. Onboarding state machine
    onb = _read_text(os.path.join(PROJECT_ROOT, "tmp", "hme-onboarding.state")) or "graduated"
    out.append(f"  onboarding         {onb}")

    # 2. Pipeline lock — is npm run main currently running?
    lock = os.path.join(PROJECT_ROOT, "tmp", "run.lock")
    if os.path.isfile(lock):
        pid = _read_text(lock)
        out.append(f"  pipeline           RUNNING (pid={pid}, started {_age(lock)})")
    else:
        out.append(f"  pipeline           idle")

    # 3. Last fingerprint verdict
    fp = _read_json(os.path.join(PROJECT_ROOT, "output", "metrics",
                                 "fingerprint-comparison.json"))
    if fp:
        verdict = fp.get("verdict", "?")
        suffix = "  (first run; no prior to compare)" if verdict == "BASELINE_MISSING" else ""
        out.append(f"  last verdict       {verdict}{suffix}")
    else:
        out.append(f"  last verdict       (no baseline yet — run pipeline once)")

    # 4. NEXUS lifecycle (briefed/edited/reviewed/committed counts)
    nexus = _read_text(os.path.join(PROJECT_ROOT, "tmp", "hme-nexus.state"))
    if nexus:
        counts = {"BRIEF": 0, "EDIT": 0, "REVIEW": 0, "COMMIT": 0, "PIPELINE": 0}
        for line in nexus.splitlines():
            for key in counts:
                if line.startswith(key + ":"):
                    counts[key] += 1
        out.append(
            f"  nexus              "
            f"brief={counts['BRIEF']} edit={counts['EDIT']} "
            f"review={counts['REVIEW']} commit={counts['COMMIT']} "
            f"pipeline={counts['PIPELINE']}"
        )
    else:
        out.append(f"  nexus              (clean)")

    # 5. KB freshness — last update time of the lance dir
    kb_dir = os.path.join(PROJECT_ROOT, "tools", "HME", "KB")
    lance_dirs = []
    if os.path.isdir(kb_dir):
        for d in os.listdir(kb_dir):
            if d.endswith(".lance"):
                lance_dirs.append(os.path.join(kb_dir, d))
    if lance_dirs:
        newest = max(os.path.getmtime(d) for d in lance_dirs)
        ago_min = int((time.time() - newest) // 60)
        out.append(
            f"  KB freshness       updated {ago_min}m ago "
            f"({len(lance_dirs)} lance dir(s))"
        )
    else:
        out.append(f"  KB freshness       (no lance directories found)")

    # 6. Latest activity event
    activity = os.path.join(PROJECT_ROOT, "output", "metrics", "hme-activity.jsonl")
    if os.path.isfile(activity):
        try:
            with open(activity) as f:
                lines = f.readlines()
            if lines:
                last = json.loads(lines[-1])
                ev = last.get("event", "?")
                src = last.get("source", last.get("session", ""))
                out.append(f"  last activity      {ev}  {src}  ({_age(activity)})")
        except (OSError, ValueError):
            pass

    # 7. Selftest verdict (lightweight; just last cached header if present)
    snap = _read_json(os.path.join(PROJECT_ROOT, "output", "metrics",
                                   "hci-verifier-snapshot.json"))
    if snap:
        hci = snap.get("hci", "?")
        n = len(snap.get("verifiers", {})) or snap.get("verifier_count", "?")
        out.append(f"  HCI                {hci}/100 ({n} verifiers)")

    if not brief:
        out.append("")
        out.append("# Drill-in:")
        out.append("  i/why mode=state                  onboarding state explanation")
        out.append("  i/hme-admin action=selftest       full readiness check")
        out.append("  i/status mode=hme                 session-state + recent activity")
        out.append("  i/status mode=hci-diff            verifier deltas since last run")

    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv) or 0)
