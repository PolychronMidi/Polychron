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
    raise RuntimeError("universal_pulse: cannot resolve repo root")
PROJECT_ROOT = _resolve_root()
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


_LAST_GOOD_CONFIG: dict | None = None


def _with_service_http_probes(cfg: dict) -> dict:
    ids = cfg.get("http_probe_services")
    if not ids:
        return cfg
    try:
        scripts_dir = PROJECT_ROOT / "tools" / "HME" / "scripts"
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        from service_registry import load_services, service_enabled, service_url

        wanted = {str(x) for x in ids}
        probes = []
        for service in load_services(PROJECT_ROOT):
            sid = str(service.get("id") or "")
            if sid not in wanted or service.get("kind") != "http":
                continue
            if not service_enabled(service):
                continue
            probes.append({
                "name": sid,
                "url": service_url(service),
                "timeout_sec": service.get("timeout_sec", 3),
                "required": bool(service.get("required", True)),
            })
        cfg = dict(cfg)
        cfg["http_probes"] = probes + list(cfg.get("http_probes_extra", []))
    except Exception as err:
        sys.stderr.write(
            f"[universal_pulse] service probe registry failed "
            f"({type(err).__name__}: {err}); using static http_probes\n")
    return cfg


def _load_config() -> dict:
    """Load universal_pulse.json with fallback to last-known-good cache.

    A corrupted config mid-admin-edit used to raise uncaught in _main,
    crashing the daemon; supervisor respawns, supervisor respawns, loop.
    We now keep the most recent successful parse and fall back to it
    (or an empty dict on first-boot failure) so one bad write doesn't
    crashloop the whole pulse layer.
    """
    global _LAST_GOOD_CONFIG
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
        cfg = _with_service_http_probes(cfg)
        _LAST_GOOD_CONFIG = cfg
        return cfg
    except (OSError, json.JSONDecodeError) as err:
        if _LAST_GOOD_CONFIG is not None:
            sys.stderr.write(
                f"[universal_pulse] config load failed ({type(err).__name__}: "
                f"{err}); using last-known-good\n")
            return _LAST_GOOD_CONFIG
        sys.stderr.write(
            f"[universal_pulse] config load failed at boot "
            f"({type(err).__name__}: {err}); using defaults\n")
        return {}


_ERROR_LOG_MAX_LINES = 20_000
_ERROR_LOG_TRIM_EVERY = 200
_log_counter = {"n": 0}


def _trim_error_log() -> None:
    r"""Bound hme-errors.log to _ERROR_LOG_MAX_LINES -- keeps tail half when
    exceeded. Called every _ERROR_LOG_TRIM_EVERY appends. Named with the
    _trim_ prefix so workflow_audit's pattern detector recognizes this
    as a legitimate bound (it greps `_trim_\w+`). Mirrors common.bounded_log
    but inlined -- pulse runs as a standalone process outside the MCP
    worker's Python path."""
    try:
        with open(ERROR_LOG, "rb") as f:
            total = sum(buf.count(b"\n") for buf in iter(lambda: f.read(65536), b""))
    except OSError:
        return
    if total <= _ERROR_LOG_MAX_LINES:
        return
    keep = _ERROR_LOG_MAX_LINES // 2
    tmp = str(ERROR_LOG) + ".trim.tmp"
    try:
        with open(ERROR_LOG, "r", encoding="utf-8", errors="replace") as src, \
             open(tmp, "w", encoding="utf-8") as dst:
            buf: list[str] = []
            for ln in src:
                buf.append(ln)
                if len(buf) > keep:
                    buf.pop(0)
            dst.writelines(buf)
        os.replace(tmp, str(ERROR_LOG))
    except OSError:
        try: os.unlink(tmp)
        except OSError: pass


def _log_error(line: str) -> None:
    """Append one line to hme-errors.log. Same format LIFESAVER scans.
    Bounded via _trim_error_log() every _ERROR_LOG_TRIM_EVERY writes."""
    ERROR_LOG.parent.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(ERROR_LOG, "a") as f:
        f.write(f"[{ts}] {line}\n")
    _log_counter["n"] += 1
    if _log_counter["n"] % _ERROR_LOG_TRIM_EVERY == 0:
        _trim_error_log()


def _write_heartbeat(path: Path, targets_ok: int, targets_bad: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "ts": int(time.time()),
        "ok": targets_ok,
        "bad": targets_bad,
    }
    tmp = path.with_suffix(path.suffix + ".tmp")
    # rationale: fsync before atomic rename prevents 0-byte heartbeat on power-cut
    with open(tmp, "w") as f:
        f.write(json.dumps(payload))
        f.flush()
        os.fsync(f.fileno())
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
_last_maintenance_seen: dict = {"ts": 0.0}


def _in_startup_grace(now: float, grace_sec: float = 120.0) -> bool:
    """True if we're within grace_sec of the most recent maintenance
    window -- skip CPU saturation checks during this window so cold-boot
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
    measured via a ~1s sample (the second `ps` reading is what we use --
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
        # Need at least 3 samples covering the window to declare saturation --
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
                # Recovered -- emit recovery line so LIFESAVER sees motion.
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
        """Return True iff we just transitioned from alerting -> healthy."""
        return key in self._last_alert_ts and self._streak.get(key, 0) == 0



# Re-exports -- tick + hook latency extracted.
from universal_pulse_tick import (  # noqa: F401, E402
    _tick, _hook_latency_per_hook, _hook_latency_p95,
)

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
        except Exception as e:  # silent-ok: logged, pulse probe self-heals
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
