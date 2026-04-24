#!/usr/bin/env python3
"""Universal pulse: active probe of every critical HME element.

Runs as a long-lived daemon. Every `interval_sec` it fires every probe
in config/universal_pulse.json; on consecutive-miss streak it appends
a single line to log/hme-errors.log so LIFESAVER surfaces the outage
at the next turn boundary. Each alert type cools down for
`cooldown_sec` so a persistent outage writes one line, not thousands.

Why: a worker that is ALIVE but GIL-saturated never fires any existing
LIFESAVER path — hooks only log rc!=0 on _safe_curl, and no caller was
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


PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT") or "/home/jah/Polychron")
CONFIG_PATH = PROJECT_ROOT / "tools" / "HME" / "config" / "universal_pulse.json"
ERROR_LOG = PROJECT_ROOT / "log" / "hme-errors.log"
DEFAULT_HEARTBEAT = PROJECT_ROOT / "tmp" / "hme-universal-pulse.heartbeat"
MAINTENANCE_FLAG = PROJECT_ROOT / "tmp" / "hme-proxy-maintenance.flag"

_shutdown = False


def _install_signal_handlers() -> None:
    def _handler(signum, _frame):
        global _shutdown
        _shutdown = True
    signal.signal(signal.SIGTERM, _handler)
    signal.signal(signal.SIGINT, _handler)


def _load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return json.load(f)


def _log_error(line: str) -> None:
    """Append one line to hme-errors.log. Same format LIFESAVER scans."""
    ERROR_LOG.parent.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(ERROR_LOG, "a") as f:
        f.write(f"[{ts}] {line}\n")


def _write_heartbeat(path: Path, targets_ok: int, targets_bad: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "ts": int(time.time()),
        "ok": targets_ok,
        "bad": targets_bad,
    }
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload))
    tmp.replace(path)


def _maintenance_active() -> bool:
    if not MAINTENANCE_FLAG.is_file():
        return False
    try:
        lines = MAINTENANCE_FLAG.read_text().splitlines()
        if len(lines) < 2:
            return False
        ttl = int(lines[1])
        start_epoch = int(subprocess.check_output(
            ["date", "-d", lines[0], "+%s"], text=True).strip())
        return (time.time() - start_epoch) < ttl
    except (ValueError, subprocess.CalledProcessError, OSError):
        return False


# Remember when maintenance flag was most recently seen active, so we can
# grant a grace period after it clears (torch checkpoint loading during a
# fresh worker boot pegs CPU for 60-90s, which legitimately spikes
# process-CPU but isn't a GIL hang).
_last_maintenance_seen: dict = {"ts": 0.0}


def _in_startup_grace(now: float, grace_sec: float = 120.0) -> bool:
    """True if we're within grace_sec of the most recent maintenance
    window — skip CPU saturation checks during this window so cold-boot
    work (checkpoint load, model warmup) doesn't trip the hang-alarm."""
    if _maintenance_active():
        _last_maintenance_seen["ts"] = now
        return True
    return (now - _last_maintenance_seen["ts"]) < grace_sec


def _probe_http(url: str, timeout_sec: float) -> tuple[bool, str]:
    """Return (ok, reason). ok=True on any 2xx. Reason is empty on ok."""
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            code = resp.getcode()
            if 200 <= code < 300:
                return True, ""
            return False, f"http_{code}"
    except urllib.error.HTTPError as e:
        return False, f"http_{e.code}"
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        return False, f"{type(e).__name__}: {str(e)[:80]}"


def _ps_cpu_instant(cmd_pattern: str) -> float:
    """Return MAX CPU% across processes whose args match cmd_pattern,
    measured via a ~1s sample (the second `ps` reading is what we use —
    first reading is cumulative since process start, which is useless)."""
    regex = re.compile(cmd_pattern)
    def _snapshot() -> float:
        try:
            out = subprocess.check_output(
                ["ps", "-eo", "pid,pcpu,args", "--no-headers"],
                text=True, timeout=3)
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError, OSError):
            return 0.0
        best = 0.0
        for line in out.splitlines():
            parts = line.strip().split(None, 2)
            if len(parts) < 3:
                continue
            _pid, pcpu_str, args = parts
            if regex.search(args):
                try:
                    pcpu = float(pcpu_str)
                except ValueError:
                    continue
                if pcpu > best:
                    best = pcpu
        return best
    # Single call: `ps` reports CPU% as cpu-time / wall-time since process
    # start by default. That's fine for sustained-saturation detection —
    # a thread that has been at 99% for 48 minutes will be near 99% in
    # this reading too. Rolling-buffer math below filters transient spikes.
    return _snapshot()


class _CpuRollingBuffer:
    """Tracks recent CPU% samples per process, returns True when all samples
    in the last `window_sec` are at/above threshold (sustained saturation)."""
    def __init__(self):
        self._samples: dict[str, list[tuple[float, float]]] = {}  # name -> [(ts, pct)]

    def record(self, name: str, pct: float, now: float, window_sec: float) -> None:
        arr = self._samples.setdefault(name, [])
        arr.append((now, pct))
        cutoff = now - window_sec
        while arr and arr[0][0] < cutoff:
            arr.pop(0)

    def saturated(self, name: str, threshold: float, window_sec: float, now: float) -> tuple[bool, float]:
        arr = self._samples.get(name, [])
        cutoff = now - window_sec
        relevant = [p for ts, p in arr if ts >= cutoff]
        # Need at least 3 samples covering the window to declare saturation —
        # prevents false-alert on first tick after fresh start.
        if len(relevant) < 3:
            return False, 0.0
        avg = sum(relevant) / len(relevant)
        return (all(p >= threshold for p in relevant), avg)


_cpu_buf = _CpuRollingBuffer()


class _StreakTracker:
    """Per-target miss streak + cooldown to suppress repeat alerts."""

    def __init__(self, miss_streak_alert: int, cooldown_sec: int):
        self.threshold = miss_streak_alert
        self.cooldown = cooldown_sec
        self._streak: dict[str, int] = {}
        self._last_alert_ts: dict[str, float] = {}

    def record(self, key: str, ok: bool, now: float) -> bool:
        """Update streak. Return True iff an alert should be emitted now."""
        if ok:
            if self._streak.get(key, 0) >= self.threshold:
                # Recovered — emit recovery line so LIFESAVER sees motion.
                self._streak[key] = 0
                self._last_alert_ts.pop(key, None)
                return False  # don't re-alert on recovery (separate log line)
            self._streak[key] = 0
            return False
        s = self._streak.get(key, 0) + 1
        self._streak[key] = s
        if s < self.threshold:
            return False
        last = self._last_alert_ts.get(key, 0)
        if now - last < self.cooldown:
            return False
        self._last_alert_ts[key] = now
        return True

    def recovered(self, key: str) -> bool:
        """Return True iff we just transitioned from alerting → healthy."""
        return key in self._last_alert_ts and self._streak.get(key, 0) == 0


def _tick(cfg: dict, tracker: _StreakTracker) -> tuple[int, int]:
    """One probe cycle. Returns (ok_count, bad_count)."""
    now = time.time()
    ok_count = 0
    bad_count = 0

    if _maintenance_active():
        # Planned proxy/worker restart — skip this tick. Don't bump streaks,
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

    # Process-level CPU saturation — each tick takes ONE instantaneous sample
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
        key = f"cpu:{name}"
        alert = tracker.record(key, not saturated, now)
        if saturated and alert:
            _log_error(
                f"[universal_pulse] CRITICAL {name} CPU-saturated "
                f"(avg={avg:.0f}% over {int(window_s)}s, threshold={int(thresh)}%) "
                f"— GIL/event-loop hang; process alive but starving handlers. "
                f"Supervisor will SIGTERM after 60s of failed health probes."
            )
            bad_count += 1

    for ff in cfg.get("file_freshness_probes", []):
        name = ff["name"]
        path = PROJECT_ROOT / ff["path"]
        max_stale = float(ff.get("max_stale_sec", 900))
        stale = True
        try:
            mtime = path.stat().st_mtime
            stale = (now - mtime) > max_stale
        except FileNotFoundError:
            stale = True
        except OSError:
            stale = True
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

    # Hook-latency probes — per-hook p95 grouped by hook name. The first
    # iteration aggregated across ALL hooks which obscured which specific
    # hook was slow (the alert named a random "sample_hook" that often
    # wasn't the real offender — e.g. reported pretooluse_bash at 50ms
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
            max_p95 = float(thresholds.get(hook_name, default_max_p95))
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
    return {hook_name: [durations_ms, …]}. Grouped so we can compute per-hook
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


def _main() -> int:
    _install_signal_handlers()
    cfg = _load_config()
    interval = int(cfg.get("interval_sec", 30))
    miss_alert = int(cfg.get("miss_streak_alert", 3))
    cooldown = int(cfg.get("cooldown_sec", 600))
    heartbeat_path = PROJECT_ROOT / cfg.get(
        "heartbeat_file", str(DEFAULT_HEARTBEAT.relative_to(PROJECT_ROOT)))

    tracker = _StreakTracker(miss_alert, cooldown)
    sys.stderr.write(
        f"[universal_pulse] started pid={os.getpid()} interval={interval}s "
        f"miss_alert={miss_alert} cooldown={cooldown}s\n")
    sys.stderr.flush()

    while not _shutdown:
        loop_start = time.monotonic()
        try:
            ok_count, bad_count = _tick(cfg, tracker)
            _write_heartbeat(heartbeat_path, ok_count, bad_count)
        except Exception as e:
            _log_error(
                f"[universal_pulse] self-error: {type(e).__name__}: "
                f"{str(e)[:120]}")
        # Subtract elapsed so we keep the cadence even when CPU probes ran long.
        elapsed = time.monotonic() - loop_start
        sleep_for = max(1.0, interval - elapsed)
        end = time.monotonic() + sleep_for
        while time.monotonic() < end and not _shutdown:
            time.sleep(min(1.0, end - time.monotonic()))
    sys.stderr.write("[universal_pulse] shutdown clean\n")
    sys.stderr.flush()
    return 0


if __name__ == "__main__":
    sys.exit(_main())
