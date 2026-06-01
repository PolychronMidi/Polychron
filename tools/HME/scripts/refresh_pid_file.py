"""Reconcile log/hme-pids against live process ground-truth.

The launcher writes hme-pids once at boot. Supervisors then respawn children
(worker force-restarts, slot rotation, omniroute relaunch) without rewriting it,
so the file goes stale -- shutdown's precise-SIGTERM path then targets dead PIDs
and falls back to pattern pkill. This rewrites hme-pids from what is actually
running, resolving each service's live PID via its pid_file or process_patterns.

Idempotent and side-effect-free beyond the single rewrite. Safe to call on every
universal_pulse tick. A service with no live process is omitted (not zeroed), so
the file only ever lists currently-alive, supervised processes.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from service_registry import (  # noqa: E402
    load_services,
    service_enabled,
    service_pid_label,
)


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _pid_from_pid_file(root: Path, spec: dict) -> int | None:
    rel = spec.get("pid_file")
    if not rel:
        return None
    try:
        pid = int((root / rel).read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None
    return pid if _pid_alive(pid) else None


def _pid_from_heartbeat(root: Path, spec: dict) -> int | None:
    # Slots a/b share process_patterns (hme_proxy.js) and are only distinguishable
    # by their per-slot heartbeat file's authoritative `pid`. Resolve this first.
    rel = spec.get("heartbeat_file")
    if not rel:
        return None
    try:
        pid = int(json.loads((root / rel).read_text(encoding="utf-8")).get("pid"))
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None
    return pid if _pid_alive(pid) else None


def _pid_from_patterns(spec: dict) -> int | None:
    for pat in spec.get("process_patterns", []) or []:
        try:
            out = subprocess.run(
                ["pgrep", "-f", pat],
                capture_output=True, text=True, timeout=3,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        pids = [int(x) for x in out.stdout.split() if x.strip().isdigit()]
        # pgrep -f can match this script's own argv; drop self + parent shell.
        pids = [p for p in pids if p not in (os.getpid(), os.getppid())]
        alive = [p for p in pids if _pid_alive(p)]
        if alive:
            return min(alive)  # oldest-by-pid == the long-lived listener, not a transient child
    return None


def resolve_live_pids(root: Path, env: dict | None = None) -> dict[str, int]:
    env = env if env is not None else dict(os.environ)
    live: dict[str, int] = {}
    for spec in load_services(root):
        if not service_enabled(spec, env):
            continue
        label = service_pid_label(spec)
        if not label:
            continue
        pid = (
            _pid_from_heartbeat(root, spec)
            or _pid_from_pid_file(root, spec)
            or _pid_from_patterns(spec)
        )
        if pid:
            live[label] = pid
    return live


def refresh(root: Path | None = None, env: dict | None = None) -> dict[str, int]:
    root = root or Path(
        os.environ.get("PROJECT_ROOT")
        or os.environ.get("CLAUDE_PROJECT_DIR")
        or Path(__file__).resolve().parents[3]
    )
    live = resolve_live_pids(root, env)
    pid_file = root / "log" / "hme-pids"
    body = "".join(f"{label}={pid}\n" for label, pid in live.items())
    tmp = pid_file.with_suffix(".tmp")
    try:
        pid_file.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(body, encoding="utf-8")
        tmp.replace(pid_file)  # atomic: a concurrent shutdown reader never sees a half-write
    except OSError:
        return live
    return live


if __name__ == "__main__":
    result = refresh()
    for label, pid in result.items():
        print(f"{label}={pid}")
