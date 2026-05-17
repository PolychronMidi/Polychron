#!/usr/bin/env python3
"""i/status state -- unified panel: every state machine in one ~15-line view.

Aggregates the 5+ state files an agent currently has to mentally
reconcile (onboarding, NEXUS lifecycle, pipeline lock, fingerprint
verdict, KB freshness, last activity).

Usage:
    i/status state              # full panel (default)
    i/status state mode=brief   # only the most-recent state of each
"""
from __future__ import annotations
import json
import os
import sys
import time
import re
import subprocess

from _common import PROJECT_ROOT, load_jsonl_all
from hme_paths import hme_metric


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


def _pid_alive(raw: str) -> bool | None:
    m = re.search(r"\d+", raw or "")
    if not m:
        return None
    pid = int(m.group(0))
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _repair_stale_pipeline_lock() -> dict:
    script = os.path.join(PROJECT_ROOT, "tools", "HME", "scripts",
                          "repair-stale-runtime.py")
    try:
        raw = subprocess.check_output(
            [sys.executable, script, "--fix", "--json"],
            cwd=PROJECT_ROOT, text=True, timeout=3, stderr=subprocess.DEVNULL,
        )
        return json.loads(raw)
    except Exception:
        return {}


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

    # 2. Pipeline lock -- is npm run main currently running?
    lock = os.path.join(PROJECT_ROOT, "tmp", "run.lock")
    if os.path.isfile(lock):
        pid = _read_text(lock)
        alive = _pid_alive(pid)
        if alive is False:
            repaired = _repair_stale_pipeline_lock()
            if repaired.get("status") == "repaired":
                out.append(f"  pipeline           repaired stale lock (dead pid={pid})")
            else:
                out.append(f"  pipeline           stale lock (dead pid={pid}, age {_age(lock)})")
        elif alive is True:
            out.append(f"  pipeline           RUNNING (pid={pid}, started {_age(lock)})")
        else:
            out.append(f"  pipeline           lock present (unparseable pid, age {_age(lock)})")
    else:
        out.append(f"  pipeline           idle")

    # 3. Last fingerprint verdict
    fp = _read_json(os.path.join(PROJECT_ROOT, "src", "output", "metrics",
                                 "fingerprint-comparison.json"))
    if fp:
        verdict = fp.get("verdict", "?")
        suffix = "  (first run; no prior to compare)" if verdict == "BASELINE_MISSING" else ""
        out.append(f"  last verdict       {verdict}{suffix}")
    else:
        out.append(f"  last verdict       (no baseline yet -- run pipeline once)")

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

    # 5. KB freshness -- last update time of the lance dir
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
    activity = str(hme_metric("hme-activity.jsonl"))
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
            pass  # silent-ok: diagnostic; failure non-fatal  # silent-ok: best-effort fs op

    # 7. HCI score with multi-timescale phase view. A single delta throws
    snap = _read_json(os.path.join(PROJECT_ROOT, "src", "output", "metrics",
                                   "hci-verifier-snapshot.json"))
    if snap:
        hci = snap.get("hci", "?")
        try:
            hci_num = float(hci)
        except (TypeError, ValueError):
            hci_num = None
        n = len(snap.get("verifiers", {})) or snap.get("verifier_count", "?")
        # Horizon II maturity -- confidence dimension on HCI line.
        scores = [info.get("score", 0) for info in snap.get("verifiers", {}).values()
                  if isinstance(info.get("score"), (int, float))]
        min_score = min(scores) if scores else None
        conf_str = ""
        if min_score is not None:
            if min_score >= 0.80:
                conf_str = f"  conf=uniform"
            elif min_score >= 0.50:
                conf_str = f"  conf=mixed (min={min_score:.2f})"
            else:
                conf_str = f"  conf=fragile (min={min_score:.2f})"
        out.append(f"  HCI                {hci}/100 ({n} verifiers){conf_str}")
        ts_path = str(hme_metric("hme-coherence-timeseries.jsonl"))
        if os.path.isfile(ts_path) and hci_num is not None:
            rows = load_jsonl_all(str(hme_metric("hme-coherence-timeseries.jsonl")))
            rows = [r for r in rows if r.get("hci") is not None]
            if len(rows) >= 2:
                now = time.time()
                horizons = [
                    ("1m  ago", now - 60),
                    ("1h  ago", now - 3600),
                    ("1d  ago", now - 86400),
                ]
                # For each horizon find the row at-or-before the cutoff
                segments = []
                for label, cutoff in horizons:
                    anchor = None
                    for r in rows:
                        if r.get("ts", 0) <= cutoff:
                            anchor = r
                        else:
                            break
                    if anchor:
                        d = hci_num - float(anchor["hci"])
                        sign = "+" if d > 0 else ""
                        segments.append(f"{label} {sign}{d:.1f}")
                    else:
                        segments.append(f"{label} -")
                # Add all-time peak vs current
                peak = max(rows, key=lambda r: r.get("hci", 0))
                peak_hci = peak.get("hci", 0)
                peak_age_h = (now - peak.get("ts", now)) / 3600
                if peak_age_h < 24:
                    peak_str = f"peak {peak_hci:.0f} ({peak_age_h:.0f}h ago)"
                else:
                    peak_str = f"peak {peak_hci:.0f} ({peak_age_h/24:.0f}d ago)"
                segments.append(peak_str)
                out.append(f"                     {' . '.join(segments)}")
        # Always check for PASS->non-PASS verifier flips, even when the
        prev_snap = _read_json(
            os.path.join(PROJECT_ROOT, "src", "output", "metrics",
                         "hci-verifier-snapshot.json.prev")
        )
        if prev_snap:
            cur_v = snap.get("verifiers", {})
            prev_v = prev_snap.get("verifiers", {})
            regressed = [
                name for name in sorted(set(cur_v) | set(prev_v))
                if prev_v.get(name, {}).get("status") == "PASS"
                and cur_v.get(name, {}).get("status") in ("FAIL", "WARN", "ERROR")
            ]
            if regressed:
                shown = ", ".join(regressed[:3])
                if len(regressed) > 3:
                    shown += f" (+{len(regressed) - 3} more)"
                out.append(f"    -> regressed: {shown}")

    # 8. KB add cadence -- proves the round-trip is working. Annotate stale
    # acceptances (>24h) so the line doesn't read as fresh forever.
    accepted = os.path.join(PROJECT_ROOT, "tmp", "hme-learn-draft.json.accepted")
    if os.path.isfile(accepted):
        try:
            age_s = time.time() - os.path.getmtime(accepted)
            stale = "  (stale: >1d)" if age_s > 86400 else ""
            out.append(f"  last KB accept     {_age(accepted)}{stale}")
        except OSError:
            pass  # silent-ok: diagnostic; failure non-fatal  # silent-ok: best-effort fs op

    # 8b. Agent-loop-quality verifier (Horizon IV asymptote-deepening).
    snap2 = _read_json(os.path.join(PROJECT_ROOT, "src", "output", "metrics",
                                    "hci-verifier-snapshot.json"))
    if snap2:
        alq = (snap2.get("verifiers") or {}).get("agent-loop-quality")
        if alq:
            status = alq.get("status", "?")
            score = alq.get("score", 0)
            marker = "." if status == "PASS" else "!"
            out.append(f"  agent-loop {marker}      {status}  score={score:.2f}  (i/status mode=agent-loop for detail)")

    # 9. Last hot-reload -- auto-reload fires on .py edits under
    reload_marker = os.path.join(PROJECT_ROOT, "tools", "HME", "runtime", "last-reload.json")
    reload_info = _read_json(reload_marker)
    if reload_info:
        try:
            age_s = time.time() - reload_info.get("ts", 0)
            trigger = reload_info.get("trigger", "?")
            human_age = (
                f"{int(age_s)}s ago" if age_s < 60 else
                f"{int(age_s/60)}m ago" if age_s < 3600 else
                f"{age_s/3600:.1f}h ago"
            )
            loaded = str(reload_info.get("loaded_head") or "")[:8]
            try:
                current = subprocess.check_output(
                    ["git", "-C", PROJECT_ROOT, "rev-parse", "HEAD"],
                    text=True, stderr=subprocess.DEVNULL, timeout=2,
                ).strip()[:8]
            except Exception:
                current = ""
            stale = " stale" if loaded and current and loaded != current else ""
            suffix = f" head={loaded}->{current}{stale}" if loaded or current else ""
            out.append(f"  last hot-reload    {human_age}  ({trigger}){suffix}")
        except (OSError, TypeError):
            pass  # silent-ok: diagnostic; failure non-fatal  # silent-ok: best-effort fs op

    # 10. Pending KB draft -- visibility for the auto-suggest after
    draft_path = os.path.join(PROJECT_ROOT, "tmp", "hme-learn-draft.json")
    if os.path.isfile(draft_path):
        try:
            age_s = time.time() - os.path.getmtime(draft_path)
            human_age = (
                f"{int(age_s)}s ago" if age_s < 60 else
                f"{int(age_s/60)}m ago" if age_s < 3600 else
                f"{age_s/3600:.1f}h ago"
            )
            out.append(f"  pending KB draft   written {human_age}  -> accept with `i/learn action=accept_draft`")
        except OSError:
            pass  # silent-ok: diagnostic; failure non-fatal  # silent-ok: best-effort fs op

    if not brief:
        out.append("")
        out.append("# Drill-in:")
        out.append("  i/why mode=state                  onboarding state explanation")
        out.append("  i/hme admin action=selftest       full readiness check")
        out.append("  i/status mode=hme                 session-state + recent activity")
        out.append("  i/status mode=hci-diff            verifier deltas since last run")
        out.append("  i/status mode=hci-by-subtag       what KIND of broken everything is")

    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv) or 0)
