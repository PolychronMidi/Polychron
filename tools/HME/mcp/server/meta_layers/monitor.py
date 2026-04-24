"""Layer 13: self-observing monitor — heartbeat + watchdog + observation gap."""
from __future__ import annotations

import json
import logging
import os
import subprocess
import time
import re

from . import _shared
from ._shared import (
    _HEARTBEAT_INTERVAL, _MONITOR_CHECK_INTERVAL, _CORRELATION_WINDOW,
    _NARRATION_INTERVAL, _MAX_NARRATIVE_LINES, _ENV_CHECK_INTERVAL,
    _ENTANGLE_INTERVAL, _COUNTERFACTUAL_FILE_SUFFIX, _SYNTHESIS_WINDOW,
    _SYNTHESIS_PATTERN_INTERVAL, _INTENT_INTERVAL, _ARCHAEOLOGY_INTERVAL,
    ENV,
)

logger = logging.getLogger("HME.meta")


def register_monitor_thread(thread: threading.Thread) -> None:

    _shared._monitor_thread_ref = thread


def _check_monitor_alive() -> dict:
    status = {"checked": True, "ts": time.time()}
    if _shared._monitor_thread_ref is None:
        status["state"] = "unregistered"
        return status
    if _shared._monitor_thread_ref.is_alive():
        status["state"] = "alive"
    else:

        _shared._monitor_restart_count += 1
        status["state"] = "dead"
        status["restart_attempt"] = _shared._monitor_restart_count
        logger.warning(
            f"Meta-observer L13: monitor thread DEAD (restart #{_shared._monitor_restart_count})"
        )
    return status


def _write_heartbeat() -> None:
    try:
        with open(_shared._ms.heartbeat_file, "w") as f:
            json.dump({"ts": time.time(), "pid": os.getpid()}, f)
    except OSError:  # silent-ok: heartbeat write is advisory; a missed beat is tolerated by readers
        pass


def _read_heartbeat() -> dict | None:
    try:
        with open(_shared._ms.heartbeat_file) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _detect_observation_gap() -> str | None:
    hb = _read_heartbeat()
    if hb is None:
        return "no prior heartbeat (first run or file lost)"
    age = time.time() - hb.get("ts", 0)
    old_pid = hb.get("pid", 0)
    # R31 #6: raised from 3x (90s) to 10x (300s = 5min). Normal idle periods
    # between sessions trip 3x repeatedly (131s, 153s, 247s gaps all benign).
    # 5min catches real downtime without the 455-entry log noise observed.
    if age > _HEARTBEAT_INTERVAL * 10:
        return f"{age:.0f}s since last heartbeat (pid {old_pid}) — meta-observer was down"
    return None
