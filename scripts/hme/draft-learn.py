#!/usr/bin/env python3
"""Generate a draft KB entry from the most recent pipeline outputs.

Reads:
- output/metrics/fingerprint-comparison.json (verdict + delta)
- output/metrics/pipeline-summary.json (passed/failed + wall time)
- git log (last commit's changed files + message)

Writes:
- $OUT (defaults to tmp/hme-learn-draft.json) — JSON {title, content, tags}

Intended caller: posttooluse_bash.sh on STABLE/EVOLVED verdict.
The agent then accepts via `i/learn action=add accept_draft=true`.
"""
from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys

PROJECT_ROOT = os.environ.get("PROJECT_ROOT", os.getcwd())


def _read_json(path: str) -> dict | None:
    try:
        with open(os.path.join(PROJECT_ROOT, path)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _git_log_summary() -> dict:
    try:
        msg = subprocess.run(
            ["git", "-C", PROJECT_ROOT, "log", "-1", "--pretty=%s"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        files = subprocess.run(
            ["git", "-C", PROJECT_ROOT, "diff", "--name-only", "HEAD~1", "HEAD"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip().splitlines()
        return {"last_commit_msg": msg, "changed_files": files}
    except (subprocess.SubprocessError, OSError):
        return {"last_commit_msg": "", "changed_files": []}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--verdict", required=True)
    p.add_argument("--session", default="unknown")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    fp = _read_json("output/metrics/fingerprint-comparison.json") or {}
    summary = _read_json("output/metrics/pipeline-summary.json") or {}
    git = _git_log_summary()

    delta = fp.get("delta") or fp.get("driftScore") or "?"
    wall = summary.get("wallTimeSeconds") or "?"
    files = git.get("changed_files", [])
    file_summary = (", ".join(files[:5]) + (f" (+{len(files) - 5} more)" if len(files) > 5 else "")) if files else "(no diff)"

    # Title: short, dated, verdict-tagged.
    msg = git.get("last_commit_msg", "").strip() or "round"
    title = f"R-? {args.verdict} — {msg[:60]}"

    # Content: structured paragraph the agent can edit before accepting.
    content_lines = [
        f"Pipeline verdict: {args.verdict}",
        f"Session: {args.session}",
        f"Wall time: {wall}s · Drift delta: {delta}",
        f"Changed files: {file_summary}",
        "",
        "What changed (one sentence):",
        f"  {msg}",
        "",
        "Why it mattered (fill in before accepting):",
        "  …",
        "",
        "Calibration anchor (what to look for next round):",
        "  …",
    ]
    content = "\n".join(content_lines)

    draft = {
        "title": title,
        "content": content,
        "tags": [args.verdict.lower(), "auto_draft"],
        "category": "decision",
    }
    out_path = args.out if os.path.isabs(args.out) else os.path.join(PROJECT_ROOT, args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    # Atomic write per CLAUDE.md guidance.
    tmp_path = out_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(draft, f, indent=2)
    os.replace(tmp_path, out_path)
    print(f"draft written: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
