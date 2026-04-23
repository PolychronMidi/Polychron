"""Operator-facing health summary — consolidates signals scattered across
selftest, hme-errors.log, daemon.out, worker.out, and /health endpoints
into one view.

Tonight's debugging required tailing 5 separate logs to answer "is the
system healthy?"; this module turns that into a single `hme_admin
action=health` call. Distinct from selftest — selftest is pre-flight
validation (0 FAIL = ready to use), health is triage ("what's going on
RIGHT NOW"). Overlapping signals are OK; the two views optimize for
different questions.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import time
import urllib.request

from hme_env import ENV

logger = logging.getLogger("HME")


def _fmt_uptime(started_ts: float) -> str:
    if not started_ts or started_ts <= 0:
        return "?"
    elapsed = time.time() - started_ts
    if elapsed < 60:
        return f"{int(elapsed)}s"
    if elapsed < 3600:
        return f"{int(elapsed // 60)}m{int(elapsed % 60)}s"
    return f"{int(elapsed // 3600)}h{int((elapsed % 3600) // 60)}m"


def _proc_start_time(pid: int) -> float:
    """Approximate process start time from /proc/<pid>/stat.
    Returns 0 if unavailable (non-Linux, process gone, permission)."""
    try:
        with open(f"/proc/{pid}/stat") as f:
            fields = f.read().rsplit(")", 1)[1].split()
        # starttime is field index 22 (0-indexed) of the post-parens section,
        # which is index 19 here after we split off up-to-)
        clock_ticks_after_boot = int(fields[19])
        hz = os.sysconf(os.sysconf_names.get("SC_CLK_TCK", 2))
        with open("/proc/stat") as f:
            btime = next(int(ln.split()[1]) for ln in f if ln.startswith("btime "))
        return btime + (clock_ticks_after_boot / hz)
    except Exception:
        return 0.0


def _pgrep(pattern: str) -> list[int]:
    try:
        out = subprocess.check_output(
            ["pgrep", "-f", pattern],
            stderr=subprocess.DEVNULL, timeout=3,
        ).decode()
        return [int(p) for p in out.strip().split() if p]
    except Exception:
        return []


def _http_get(url: str, timeout: float = 2.0) -> str | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.read().decode(errors="replace")[:200]
    except Exception as e:
        return f"unreachable ({type(e).__name__})"


def _gpu_state() -> list[dict]:
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=index,memory.free,memory.used,memory.total,utilization.gpu",
             "--format=csv,noheader,nounits"],
            stderr=subprocess.DEVNULL, timeout=3,
        ).decode()
        gpus = []
        for line in out.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 5:
                gpus.append({
                    "index": int(parts[0]),
                    "free_mb": int(parts[1]),
                    "used_mb": int(parts[2]),
                    "total_mb": int(parts[3]),
                    "util_pct": int(parts[4]),
                })
        return gpus
    except Exception as e:
        return [{"error": f"{type(e).__name__}: {e}"}]


def _recent_errors(log_path: str, minutes: int = 10) -> list[str]:
    if not os.path.isfile(log_path):
        return []
    threshold = time.time() - minutes * 60
    errors: list[str] = []
    try:
        with open(log_path, encoding="utf-8", errors="replace") as f:
            for line in f.readlines()[-200:]:
                if "[ERROR]" not in line and "ERROR" not in line[:30]:
                    continue
                # Parse timestamp prefix (format: "2026-04-23 02:41:16,907")
                try:
                    ts_str = line[:19]
                    ts = time.mktime(time.strptime(ts_str, "%Y-%m-%d %H:%M:%S"))
                    if ts >= threshold:
                        errors.append(line.rstrip())
                except Exception:
                    continue
    except Exception as e:
        errors.append(f"(log read failed: {e})")
    return errors


def _probe_versions(project_root: str) -> tuple[str, list[str]]:
    """Probe canonical + live versions, return (banner_line, mismatch_list)."""
    try:
        versions_path = os.path.join(project_root, "tools", "HME", "config", "versions.json")
        with open(versions_path) as f:
            canonical = json.load(f)
    except Exception as e:
        return f"  versions: canonical file unreadable ({e})", []
    live = {}
    for name, url in [
        ("daemon", "http://127.0.0.1:7735/version"),
        ("worker", "http://127.0.0.1:9098/version"),
    ]:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                live[name] = json.loads(r.read()).get("version", "?")
        except Exception:
            live[name] = "unreachable"
    mismatches = [
        f"{name}: live={live[name]} canonical={canonical.get(name, '?')}"
        for name in ("daemon", "worker")
        if live.get(name) not in ("unreachable", "?", canonical.get(name))
    ]
    banner = (
        f"  versions: daemon={live.get('daemon')} worker={live.get('worker')} "
        f"canonical={canonical.get('worker')}"
    )
    if mismatches:
        banner += "  ** DRIFT **"
    return banner, mismatches


def health() -> str:
    """Operator health summary. One call, all signals."""
    project_root = ENV.optional("PROJECT_ROOT", "") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    lines: list[str] = ["## HME Health Summary", ""]

    # Version consistency — surfaced top so drift is unmissable.
    v_banner, v_mismatches = _probe_versions(project_root)
    lines.append("### Versions")
    lines.append(v_banner)
    if v_mismatches:
        for m in v_mismatches:
            lines.append(f"    ! {m}")
    lines.append("")

    # Processes
    lines.append("### Processes")
    daemon_pids = _pgrep("llamacpp_daemon.py")
    worker_pids = _pgrep("worker.py")
    ls_pids = _pgrep("tools/bin/llama-server")
    if len(daemon_pids) == 1:
        lines.append(f"  daemon:  PID {daemon_pids[0]}  up {_fmt_uptime(_proc_start_time(daemon_pids[0]))}")
    elif len(daemon_pids) == 0:
        lines.append("  daemon:  NOT RUNNING ← lifecycle authority absent")
    else:
        lines.append(f"  daemon:  ** {len(daemon_pids)} INSTANCES ** {daemon_pids} ← single-writer violation")
    if len(worker_pids) == 1:
        lines.append(f"  worker:  PID {worker_pids[0]}  up {_fmt_uptime(_proc_start_time(worker_pids[0]))}")
    elif len(worker_pids) == 0:
        lines.append("  worker:  NOT RUNNING")
    else:
        lines.append(f"  worker:  ** {len(worker_pids)} INSTANCES ** {worker_pids}")
    for pid in ls_pids:
        try:
            with open(f"/proc/{pid}/cmdline") as f:
                cmd = f.read().replace("\0", " ")
            alias = "?"
            if "--alias" in cmd:
                alias = cmd.split("--alias", 1)[1].split()[0]
            lines.append(f"  llama:   PID {pid}  alias={alias}  up {_fmt_uptime(_proc_start_time(pid))}")
        except Exception:
            lines.append(f"  llama:   PID {pid} (cmdline unreadable)")
    if len(ls_pids) > 2:
        lines.append(f"  ** {len(ls_pids)} llama-server processes — topology declares 2 (arbiter + coder)")
    lines.append("")

    # Ports / endpoints
    lines.append("### Endpoints")
    for name, url in [
        ("daemon  ", "http://127.0.0.1:7735/health"),
        ("worker  ", "http://127.0.0.1:9098/health"),
        ("arbiter ", "http://127.0.0.1:8080/health"),
        ("coder   ", "http://127.0.0.1:8081/health"),
    ]:
        body = _http_get(url)
        status = "ok" if body and "unreachable" not in body else (body or "?")
        lines.append(f"  {name}{url}  →  {status[:80]}")
    lines.append("")

    # GPU
    lines.append("### GPU")
    for gpu in _gpu_state():
        if "error" in gpu:
            lines.append(f"  probe failed: {gpu['error']}")
            continue
        pct = round(100 * gpu["used_mb"] / max(1, gpu["total_mb"]))
        bar_used = "#" * (pct // 5)
        bar_free = "." * (20 - (pct // 5))
        lines.append(
            f"  GPU{gpu['index']}: {gpu['used_mb']:>5}/{gpu['total_mb']:>5} MB "
            f"[{bar_used}{bar_free}] {pct:>3}% used  {gpu['util_pct']:>3}% util"
        )
    lines.append("")

    # Recent errors (last 10 min across the 3 most relevant logs)
    lines.append("### Recent errors (last 10 min)")
    any_errors = False
    for logfile in ["hme-llamacpp_daemon.out", "hme-worker.out", "hme-errors.log"]:
        path = os.path.join(project_root, "log", logfile)
        errs = _recent_errors(path, minutes=10)
        if errs:
            any_errors = True
            lines.append(f"  {logfile}:")
            for err in errs[-5:]:
                # Strip timestamp + level prefix for readability
                short = err[24:200] if len(err) > 24 else err
                lines.append(f"    {short}")
    if not any_errors:
        lines.append("  (none)")
    lines.append("")

    # Single-writer registry snapshot
    lines.append("### Single-writer domains")
    try:
        from server.lifecycle_writers import all_domains
        for domain, owner in sorted(all_domains().items()):
            lines.append(f"  {domain:<20} → {owner}")
    except Exception as e:
        lines.append(f"  (registry unavailable: {e})")

    return "\n".join(lines)
