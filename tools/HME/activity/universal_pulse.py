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


def _ps_cpu_samples(cmd_pattern: str, duration_sec: float, sample_every: float = 5.0) -> list[float]:
    """Sample CPU% of processes matching cmd_pattern every `sample_every` s
    for `duration_sec`. Returns the list of MAX CPU% across matching PIDs
    per sample (one PID typically, but if several match we alert on the
    hottest)."""
    regex = re.compile(cmd_pattern)
    samples: list[float] = []
    deadline = time.monotonic() + duration_sec
    while time.monotonic() < deadline and not _shutdown:
        try:
            out = subprocess.check_output(
                ["ps", "-eo", "pid,pcpu,args", "--no-headers"],
                text=True, timeout=3)
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError, OSError):
            samples.append(0.0)
            time.sleep(sample_every)
            continue
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
        samples.append(best)
        time.sleep(sample_every)
    return samples


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

    # Process-level CPU saturation — runs in-band so it blocks interval; window
    # is short (<= sum of cpu_saturation_secs across process_probes). For the
    # worker probe (90s window at 5s cadence) this is the whole interval and
    # is load-bearing: catches GIL-saturation at the exact resolution needed.
    for pp in cfg.get("process_probes", []):
        name = pp["name"]
        pattern = pp["cmd_pattern"]
        thresh = float(pp.get("cpu_saturation_pct", 90))
        window_s = float(pp.get("cpu_saturation_secs", 90))
        samples = _ps_cpu_samples(pattern, window_s, sample_every=5.0)
        if not samples:
            continue
        # Sustained saturation: every sample in the window at or above threshold.
        saturated = all(s >= thresh for s in samples)
        key = f"cpu:{name}"
        alert = tracker.record(key, not saturated, now)
        if saturated and alert:
            avg = sum(samples) / len(samples)
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

    return ok_count, bad_count


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
