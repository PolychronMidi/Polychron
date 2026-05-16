#!/usr/bin/env python3
"""Stale-state-file sweeper. Walks tools/HME/runtime/ and applies each file's
documented stale-criterion (per INVENTORY.md). When stale, unlinks.

Catches the supervisor-abandoned bug class generally: any state file
whose owner forgot the cleanup path (or whose owner crashed before
clearing) gets recovered automatically rather than persisting forever.

Cron-cheap: each check is one HTTP HEAD (worker/daemon health) or one
mtime check. Run every UserPromptSubmit (sub-50ms) or as a watchdog tick.

Verdicts: prints `<file> <verdict> <reason>` per known file.
Exit 0 always.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import urllib.error


def _project_root() -> str:
    return (
        os.environ.get("PROJECT_ROOT")
        or os.environ.get("CLAUDE_PROJECT_DIR")
        or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    )


PROJECT_ROOT = _project_root()
sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "scripts"))
from service_registry import service_map, service_url  # noqa: E402


def _http_health_ok(url: str, timeout: float = 1.5) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= r.status < 300
    except (urllib.error.URLError, OSError, ValueError):
        return False


def _check_supervisor_abandoned(path: str) -> tuple[str, str]:
    """Stale if the named child's healthURL responds 200."""
    if not os.path.exists(path):
        return "absent", "no sentinel"
    try:
        with open(path) as f:
            sent = json.load(f)
        child = sent.get("child", "")
    except (OSError, ValueError):
        return "kept", "unparseable JSON"
    services = service_map()
    url = service_url(services[child]) if child in services else None
    if url and _http_health_ok(url):
        os.unlink(path)
        return "unlinked", f"{child} healthURL=200 (sentinel stale)"
    return "kept", f"{child} unhealthy or unknown"


def _check_fp_gate_armed(path: str) -> tuple[str, str]:
    """Stale if armed >5min ago without consumption (consumer crashed)."""
    if not os.path.exists(path):
        return "absent", "no flag"
    age = time.time() - os.path.getmtime(path)
    if age > 300:
        os.unlink(path)
        return "unlinked", f"armed {int(age)}s ago, never consumed"
    return "kept", f"armed {int(age)}s ago"


# Each entry: (filename-in-tools/HME/runtime, check-function).
# Add new state files here as they migrate from tmp/.
CHECKS = [
    ("supervisor-abandoned", _check_supervisor_abandoned),
    ("fp-gate-armed.flag", _check_fp_gate_armed),
]


def main() -> int:
    runtime_dir = os.path.join(_project_root(), "runtime", "hme")
    if not os.path.isdir(runtime_dir):
        print(f"runtime dir absent: {runtime_dir}")
        return 0
    for fname, check in CHECKS:
        full = os.path.join(runtime_dir, fname)
        try:
            verdict, reason = check(full)
        except Exception as e:
            verdict, reason = "error", f"{type(e).__name__}: {e}"
        print(f"{fname} {verdict} {reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
