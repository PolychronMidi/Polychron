#!/usr/bin/env python3
"""Background-fork health watchdog. Catches silent harness drops.

The harness completion-notification system silently dropped 3 Explore forks
this session (transcripts ended `stop_reason: end_turn`, no notification
arrived, TaskOutput returned 'no task found'). This watchdog scans the live
agent-meta files vs the .jsonl transcripts and surfaces forks whose
transcripts ended (stop_reason set) but whose harness still considers them
pending.

Usage:
  i/status forks                # one-shot check
  i/status forks --json         # machine output

Detects:
  - completed: stop_reason in {end_turn, stop_sequence, max_tokens}
  - notification_lost: completed AND age > 60s AND no observable downstream
    consumer (harness should have queued the notification by now)
  - long_running: not yet completed, runtime > 600s (likely stuck)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

_HOME = Path(os.environ.get("HOME", "/home/jah"))


def _find_subagent_dirs() -> list[Path]:
    """Discover per-session subagents dirs. Layout is projects/<proj>/<session>/subagents."""
    out: list[Path] = []
    projects = _HOME / ".claude" / "projects"
    if not projects.is_dir():
        return out
    for proj in projects.iterdir():
        if not proj.is_dir():
            continue
        for sess in proj.iterdir():
            if not sess.is_dir():
                continue
            sa = sess / "subagents"
            if sa.is_dir():
                out.append(sa)
    return out


def _last_message_info(jsonl: Path) -> dict:
    try:
        with open(jsonl, "rb") as f:
            f.seek(0, 2)
            end = f.tell()
            f.seek(max(0, end - 8192))
            tail = f.read().decode("utf-8", errors="ignore")
    except OSError:
        return {}
    for ln in reversed(tail.strip().split("\n")):
        if not ln.strip():
            continue
        try:
            d = json.loads(ln)
        except ValueError:
            continue
        msg = d.get("message") or {}
        return {
            "type": d.get("type"),
            "stop_reason": msg.get("stop_reason"),
            "ts": (jsonl.stat().st_mtime if jsonl.exists() else 0),
        }
    return {}


_ARCHIVE_AFTER_DAYS = 7


def _rotate_old_transcripts(sa_dir: Path) -> int:
    """Move agent-*.jsonl + .meta.json files older than _ARCHIVE_AFTER_DAYS into
    sa_dir/.archive/. Keeps the live scan O(recent) instead of O(all-history).
    Returns count rotated."""
    archive = sa_dir / ".archive"
    cutoff = time.time() - _ARCHIVE_AFTER_DAYS * 86400
    n = 0
    for jsonl in sa_dir.glob("agent-*.jsonl"):
        try:
            if jsonl.stat().st_mtime >= cutoff:
                continue
        except OSError:
            continue
        archive.mkdir(parents=True, exist_ok=True)
        try:
            jsonl.rename(archive / jsonl.name)
            n += 1
            meta = sa_dir / (jsonl.stem + ".meta.json")
            if meta.is_file():
                meta.rename(archive / meta.name)
        except OSError:
            pass  # silent-ok: best-effort fs op
    return n


def scan() -> list[dict]:
    findings: list[dict] = []
    now = time.time()
    for sa_dir in _find_subagent_dirs():
        _rotate_old_transcripts(sa_dir)
        for jsonl in sa_dir.glob("agent-*.jsonl"):
            meta = sa_dir / (jsonl.stem + ".meta.json")
            if not meta.is_file():
                continue
            info = _last_message_info(jsonl)
            if not info:
                continue
            age_s = now - info.get("ts", now)
            entry = {
                "agent_id": jsonl.stem.replace("agent-", ""),
                "session": sa_dir.parent.name,
                "stop_reason": info.get("stop_reason"),
                "age_s": int(age_s),
                "size_kb": jsonl.stat().st_size // 1024,
            }
            sr = info.get("stop_reason")
            if sr in ("end_turn", "stop_sequence", "max_tokens"):
                # notification_lost only for recently-completed (60s..1h window).
                entry["state"] = "notification_lost" if 60 < age_s < 3600 else "completed"
            elif age_s > 600 and age_s < 86400:
                entry["state"] = "long_running"
            else:
                entry["state"] = "active"
            findings.append(entry)
    return findings


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    findings = scan()
    if args.json:
        print(json.dumps({"findings": findings}, indent=2))
        return 0
    lost = [f for f in findings if f["state"] == "notification_lost"]
    stuck = [f for f in findings if f["state"] == "long_running"]
    if not lost and not stuck:
        print(f"fork-watchdog: 0 issues across {len(findings)} fork(s) scanned")
        return 0
    if lost:
        print(f"fork-watchdog: {len(lost)} fork(s) completed but notification not delivered:")
        for f in lost:
            print(f"  agent_id={f['agent_id'][:16]} stop={f['stop_reason']} age={f['age_s']}s size={f['size_kb']}KB")
    if stuck:
        print(f"fork-watchdog: {len(stuck)} long-running fork(s) (>600s, may be stuck):")
        for f in stuck:
            print(f"  agent_id={f['agent_id'][:16]} age={f['age_s']}s size={f['size_kb']}KB")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
