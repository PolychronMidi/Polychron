#!/usr/bin/env python3
"""Universal pulse: active probe of every critical HME element.

Runs as a long-lived daemon. Every `interval_sec` it fires every probe
in config/universal_pulse.json; on consecutive-miss streak it appends
a single line to log/hme-errors.log so LIFESAVER surfaces the outage
at the next turn boundary. Each alert type cools down for
`cooldown_sec` so a persistent outage writes one line, not thousands.

Why: a worker that is ALIVE but GIL-saturated never fires any existing
LIFESAVER path -- hooks only log rc!=0 on _safe_curl, and no caller was
necessarily running against the hung endpoint. The pulse closes that
gap by probing proactively from outside the affected process.
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def _resolve_root() -> Path:
    val = os.environ.get("PROJECT_ROOT") or os.environ.get("CLAUDE_PROJECT_DIR")
    if val and (Path(val) / ".env").is_file():
        return Path(val)
    cur = Path(__file__).resolve().parent
    while cur != cur.parent:
        if (cur / ".env").is_file() and (cur / ".git").is_dir():
            return cur
        cur = cur.parent
    raise RuntimeError("universal_pulse_tick: cannot resolve repo root")
PROJECT_ROOT = _resolve_root()
CONFIG_PATH = PROJECT_ROOT / "tools" / "HME" / "config" / "universal_pulse.json"
ERROR_LOG = PROJECT_ROOT / "log" / "hme-errors.log"
DEFAULT_HEARTBEAT = PROJECT_ROOT / "tmp" / "hme-universal-pulse.heartbeat"
MAINTENANCE_FLAG = PROJECT_ROOT / "tmp" / "hme-proxy-maintenance.flag"

_shutdown = False


def _resolve_threshold(hook_name, thresholds, default_ms):
    """Per-hook latency threshold lookup with prefix fallback.

    Mirrors runtime_perf.HookLatencyVerifier._budget_for so the daemon
    and the verifier agree on which budget applies. Without prefix
    matching, every shell_policy substage (`stop_chain:holograph`,
    `stop_chain:autocommit`, etc.) fell to default_ms even though its
    parent `stop` had a calibrated override -- producing false-alarm
    spam in hme-errors.log on every tick.

    Order: exact match wins; otherwise the LONGEST matching prefix from
    `thresholds` wins. Longest-prefix avoids accidental hits like
    `stopwatch` matching the `stop` budget when both are configured.
    """
    if hook_name in thresholds:
        return float(thresholds[hook_name])
    best_key = None
    for key in thresholds:
        if hook_name.startswith(key) and (best_key is None or len(key) > len(best_key)):
            best_key = key
    if best_key is not None:
        return float(thresholds[best_key])
    return float(default_ms)


def _tick(cfg, tracker):
    """One probe cycle. Returns (ok_count, bad_count).

    Helpers (_maintenance_active / _probe_http / _StreakTracker) live
    in universal_pulse.py. Imported here lazily because the parent
    module also imports from this one at module load (circular).
    """
    from universal_pulse import (  # noqa: F401
        _maintenance_active, _probe_http, _log_error,
        _in_startup_grace, _cpu_buf, _ps_cpu_instant,
    )

    now = time.time()
    ok_count = 0
    bad_count = 0

    if _maintenance_active():
        # Planned proxy/worker restart -- skip this tick. Don't bump streaks,
        # don't fire alerts; the operator owns the window.
        return 0, 0

    for probe in cfg.get("http_probes", []):
        name = probe["name"]
        url = probe["url"]
        timeout = float(probe.get("timeout_sec", 3))
        required = bool(probe.get("required", True))
        ok, reason = _probe_http(url, timeout)
        key = f"http:{name}"
        recovered_before = tracker.recovered(key)
        alert = tracker.record(key, ok, now)
        if ok:
            ok_count += 1
            if recovered_before:
                _log_error(f"[universal_pulse] RECOVERED {name} ({url})")
        else:
            bad_count += 1
            if alert:
                severity = "CRITICAL" if required else "WARN"
                _log_error(
                    f"[universal_pulse] {severity} {name} unresponsive at {url} "
                    f"({reason}); streak exceeded, no response in ~"
                    f"{tracker.threshold * cfg.get('interval_sec', 30)}s"
                )

    # Process-level CPU saturation -- each tick takes ONE instantaneous sample
    # per tracked process and feeds a rolling buffer. Sustained saturation is
    # declared when every sample within the saturation window is at/above
    # threshold. This keeps the tick bounded (~1 ps call per process) while
    # still catching the 48-min GIL-hang case at window resolution.
    #
    # Startup grace: during and up to grace_sec AFTER any maintenance flag,
    # skip CPU saturation checks. Cold-boot legitimately spikes CPU while
    # torch loads checkpoints / GPU warms up (60-90s typical). The grace
    # window prevents false CRITICAL alerts during these known-costly phases.
    # Real GIL hangs resume being caught as soon as the grace ends.
    _in_grace = _in_startup_grace(now)
    if _in_grace:
        # Clear any rolling-buffer samples collected during grace so a
        # long startup doesn't leave saturated entries that would
        # trigger alerts once grace ends.
        for pp in cfg.get("process_probes", []):
            _cpu_buf._samples.pop(pp.get("name", ""), None)
            tracker.record(f"cpu:{pp.get('name','')}", True, now)
    # Build a map of which process names have a CURRENTLY-FAILING http
    # probe. Real GIL hang has both signals: CPU pegged AND /health
    # unresponsive. Legitimate ML inference workload (sentence-transformers
    # tokenizing on CPU while GPU does the heavy lift) pegs CPU at 200%+
    # but /health returns instantly. The old check fired on the legitimate
    # case, producing false-positive CRITICAL alerts every 90s during
    # any sustained inference. Real hangs still fire because /health
    # also fails when the GIL is held; the http_probes loop above already
    # tracked that streak.
    _http_failing_now: set[str] = set()
    for probe in cfg.get("http_probes", []):
        name = probe["name"]
        # The streak tracker stores the most recent record; if the
        # current http probe failed (not ok), it has streak >= 1.
        if tracker._streak.get(f"http:{name}", 0) >= 1:
            _http_failing_now.add(name)

    for pp in cfg.get("process_probes", []):
        if _in_grace:
            break
        name = pp["name"]
        pattern = pp["cmd_pattern"]
        thresh = float(pp.get("cpu_saturation_pct", 90))
        window_s = float(pp.get("cpu_saturation_secs", 90))
        pct = _ps_cpu_instant(pattern)
        # Keep rolling buffer twice the window so saturated() has coverage.
        _cpu_buf.record(name, pct, now, window_s * 2)
        saturated, avg = _cpu_buf.saturated(name, thresh, window_s, now)
        # Only alert when CPU saturation IS PAIRED WITH http-probe failure.
        # CPU-saturated alone = legitimate inference workload.
        # CPU-saturated AND /health failing = the GIL-starved hang this
        # check exists to catch.
        is_real_hang = saturated and (name in _http_failing_now)
        key = f"cpu:{name}"
        alert = tracker.record(key, not is_real_hang, now)
        if is_real_hang and alert:
            _log_error(
                f"[universal_pulse] CRITICAL {name} CPU-saturated "
                f"(avg={avg:.0f}% over {int(window_s)}s, threshold={int(thresh)}%) "
                f"AND /health unresponsive -- GIL/event-loop hang; "
                f"process alive but starving handlers. Supervisor will "
                f"SIGTERM after 60s of failed health probes."
            )
            bad_count += 1

    for ff in cfg.get("file_freshness_probes", []):
        name = ff["name"]
        path = PROJECT_ROOT / ff["path"]
        max_stale = float(ff.get("max_stale_sec", 900))
        # Optional paired_path: only flag stale when the paired writer is
        # FRESH but the target is stale. Both stale = idle session, not
        # broken. Closes the false-positive class where idle-time gaps
        # between turns generated spurious LIFESAVER alerts.
        paired_rel = ff.get("paired_path")
        paired_path = PROJECT_ROOT / paired_rel if paired_rel else None
        stale = True
        try:
            mtime = path.stat().st_mtime
            stale = (now - mtime) > max_stale
        except FileNotFoundError:
            stale = True
        except OSError:
            stale = True
        # Paired-staleness gating: if both files are equally stale (or the
        # pair is staler), suppress the alert -- the session is idle.
        if stale and paired_path is not None:
            try:
                paired_mtime = paired_path.stat().st_mtime
                paired_stale = (now - paired_mtime) > max_stale
                if paired_stale:
                    stale = False  # both stale -> idle, not broken
            except (FileNotFoundError, OSError):
                # Paired file missing -- fall through to flag the original.
                pass
        key = f"fresh:{name}"
        alert = tracker.record(key, not stale, now)
        if stale and alert:
            _log_error(
                f"[universal_pulse] WARN {name} stale (>{int(max_stale)}s since "
                f"last write at {ff['path']}); upstream writer may be dead."
            )
            bad_count += 1
        elif not stale:
            ok_count += 1

    # Hook-latency probes -- per-hook p95 grouped by hook name. The first
    # iteration aggregated across ALL hooks which obscured which specific
    # hook was slow (the alert named a random "sample_hook" that often
    # wasn't the real offender -- e.g. reported pretooluse_bash at 50ms
    # while the actual culprit was stop at 676ms). Now we compute p95
    # per hook and fire per-hook alerts, each with an accurate name.
    # Per-hook thresholds overridable via cfg[hook_thresholds][<hook>].
    for lp in cfg.get("hook_latency_probes", []):
        name = lp["name"]
        log_path = PROJECT_ROOT / lp["path"]
        window_sec = float(lp.get("window_sec", 600))
        default_max_p95 = float(lp.get("max_p95_ms", 500))
        sample_min = int(lp.get("sample_min", 10))
        thresholds = lp.get("hook_thresholds", {})  # per-hook overrides
        per_hook = _hook_latency_per_hook(log_path, window_sec, now)
        if not per_hook:
            tracker.record(f"hook_lat:{name}", True, now)
            continue
        any_slow = False
        for hook_name, durs in per_hook.items():
            if len(durs) < sample_min:
                continue
            durs_sorted = sorted(durs)
            p95_idx = min(len(durs_sorted) - 1, int(len(durs_sorted) * 0.95))
            p95_ms = durs_sorted[p95_idx]
            max_p95 = _resolve_threshold(hook_name, thresholds, default_max_p95)
            key = f"hook_lat:{name}:{hook_name}"
            healthy = p95_ms <= max_p95
            alert = tracker.record(key, healthy, now)
            if not healthy and alert:
                _log_error(
                    f"[universal_pulse] WARN hook latency {hook_name} "
                    f"p95={p95_ms:.0f}ms > {int(max_p95)}ms "
                    f"(n={len(durs)} in last {int(window_sec)}s)"
                )
                any_slow = True
        if any_slow:
            bad_count += 1
        else:
            ok_count += 1

    return ok_count, bad_count


def _hook_latency_per_hook(log_path: Path, window_sec: float, now: float) -> dict[str, list[float]]:
    """Scan the last ~256KB of hme-hook-latency.jsonl within the window and
    return {hook_name: [durations_ms, ...]}. Grouped so we can compute per-hook
    p95 rather than an aggregate that hides which hook is actually slow."""
    if not log_path.is_file():
        return {}
    try:
        size = log_path.stat().st_size
        read_from = max(0, size - 256 * 1024)
        with open(log_path, "rb") as f:
            if read_from:
                f.seek(read_from)
                f.readline()
            data = f.read().decode("utf-8", errors="replace")
    except OSError:
        return {}
    cutoff = now - window_sec
    out: dict[str, list[float]] = {}
    for line in data.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = entry.get("ts")
        if not isinstance(ts, (int, float)) or ts < cutoff:
            continue
        dur = entry.get("duration_ms")
        hook = entry.get("hook")
        if not isinstance(dur, (int, float)) or not isinstance(hook, str):
            continue
        out.setdefault(hook, []).append(float(dur))
    return out


def _hook_latency_p95(log_path: Path, window_sec: float, now: float,
                      hook_filter: str | None) -> tuple[float, int, str | None]:
    """Scan the last ~256KB of hme-hook-latency.jsonl for entries within the
    window and return (p95_ms, sample_count, representative_hook)."""
    if not log_path.is_file():
        return 0.0, 0, None
    try:
        size = log_path.stat().st_size
        read_from = max(0, size - 256 * 1024)
        with open(log_path, "rb") as f:
            if read_from:
                f.seek(read_from)
                f.readline()  # drop partial first line
            data = f.read().decode("utf-8", errors="replace")
    except OSError:
        return 0.0, 0, None
    cutoff = now - window_sec
    durations: list[float] = []
    representative: str | None = None
    for line in data.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = entry.get("ts")
        if not isinstance(ts, (int, float)) or ts < cutoff:
            continue
        if hook_filter and entry.get("hook") != hook_filter:
            continue
        dur = entry.get("duration_ms")
        if not isinstance(dur, (int, float)):
            continue
        durations.append(float(dur))
        if representative is None:
            representative = entry.get("hook")
    if not durations:
        return 0.0, 0, None
    durations.sort()
    p95_idx = int(len(durations) * 0.95)
    if p95_idx >= len(durations):
        p95_idx = len(durations) - 1
    return durations[p95_idx], len(durations), representative


