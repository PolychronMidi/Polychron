#!/usr/bin/env python3
"""Lightweight background VRAM monitor.

Samples free/used memory on each GPU every 30 seconds and appends a JSONL
record to metrics/vram-history.jsonl. Self-trims to keep the file bounded
(~2000 most recent samples = 16 hours of history at 30s intervals).

Purpose: give us historical data to decide if/when to switch to partial
offloading as KB and warm-cache sizes grow. Today it's only used by the
HME status tool for "last N minutes" trend display; tomorrow it can feed
a decision engine that auto-moves models between GPU and CPU.

Runs as a detached daemon spawned by hme_http.py at startup. Idempotent:
checks its own pid file and exits if a live instance is already running.
"""
import json
import os
import signal
import subprocess
import sys
import time

# Central .env loader — fail-fast semantics.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hme_env import ENV  # noqa: E402

PID_FILE = "/tmp/hme-vram-monitor.pid"
POLL_INTERVAL = ENV.require_int("HME_VRAM_POLL_S")
MAX_SAMPLES = ENV.require_int("HME_VRAM_MAX_SAMPLES")
PROJECT_ROOT = ENV.require("PROJECT_ROOT")
METRICS_DIR = os.path.join(PROJECT_ROOT, "output", "metrics")
HISTORY_FILE = os.path.join(METRICS_DIR, "vram-history.jsonl")


def _existing_instance_alive() -> bool:
    try:
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
        os.kill(pid, 0)
        return True
    except (FileNotFoundError, ValueError, ProcessLookupError):
        return False


def _query_gpus() -> list[dict]:
    """Return a list of {index, used_mb, free_mb, total_mb, util_pct} per GPU.
    Falls back to empty list if nvidia-smi is unavailable."""
    try:
        out = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=index,memory.used,memory.free,memory.total,utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            timeout=5,
        ).decode()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return []
    gpus = []
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 5:
            continue
        try:
            gpus.append({
                "index": int(parts[0]),
                "used_mb": int(parts[1]),
                "free_mb": int(parts[2]),
                "total_mb": int(parts[3]),
                "util_pct": int(parts[4]),
            })
        except ValueError:
            continue
    return gpus


def _append_sample(record: dict) -> None:
    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
    with open(HISTORY_FILE, "a") as f:
        f.write(json.dumps(record) + "\n")


def _trim_history() -> None:
    """Keep the most recent MAX_SAMPLES lines. Called infrequently (every 100 samples)."""
    try:
        with open(HISTORY_FILE) as f:
            lines = f.readlines()
    except FileNotFoundError:
        return
    if len(lines) <= MAX_SAMPLES:
        return
    with open(HISTORY_FILE + ".tmp", "w") as f:
        f.writelines(lines[-MAX_SAMPLES:])
    os.replace(HISTORY_FILE + ".tmp", HISTORY_FILE)


def main() -> None:
    if _existing_instance_alive():
        print("vram_monitor: another instance already running, exiting", file=sys.stderr)
        return

    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    def _shutdown(signum, frame):
        try:
            os.remove(PID_FILE)
        except FileNotFoundError:  # silent-ok: shutdown-handler PID cleanup; file may already be absent
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    sample_count = 0
    while True:
        gpus = _query_gpus()
        if gpus:
            record = {
                "ts": int(time.time()),
                "gpus": gpus,
            }
            try:
                _append_sample(record)
            except OSError:  # silent-ok: per-sample write at 1Hz; logging every failure would spam, next sample retries
                pass
            sample_count += 1
            if sample_count >= 100:
                try:
                    _trim_history()
                except OSError:  # silent-ok: history-file trim; failure defers compaction one cycle
                    pass
                sample_count = 0
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
