"""HME persistent operational memory — Layer 2 of the self-coherence stack.

Tracks system health metrics that survive across MCP server restarts:
  - restart count per day
  - recovery success/failure rate (EMA)
  - shim crash frequency
  - startup timing EMA
  - cache hit rate EMA
  - circuit breaker trip history

Written atomically to $PROJECT_ROOT/tmp/hme-ops.json on every state change.
Read on startup; per-day counters reset on new calendar day while preserving
rolling EMAs so long-term trends survive day boundaries.

Layer 5 (Temporal Rhythm) reads is_crash_loop() and restarts_today to adapt
the startup chain aggressiveness. Layer 7 (Predictive Health) updates EMAs here.
"""
import json
import os
import time
import threading
import logging

logger = logging.getLogger("HME")

_STATE_FILE: str = ""
_state: dict = {}
_state_lock = threading.Lock()
_EMA_ALPHA = 0.2  # exponential moving average decay for rolling metrics


def init(project_root: str) -> dict:
    """Initialize operational state from disk. Returns the loaded state snapshot.

    Increments restarts_today; preserves EMAs and long-term metrics across day boundaries.
    Safe to call multiple times — subsequent calls are no-ops (STATE_FILE already set).
    """
    global _STATE_FILE, _state
    if _STATE_FILE:
        return snapshot()  # already initialized
    _STATE_FILE = os.path.join(project_root, "tmp", "hme-ops.json")
    os.makedirs(os.path.dirname(_STATE_FILE), exist_ok=True)
    today = time.strftime("%Y-%m-%d")
    try:
        with open(_STATE_FILE) as f:
            loaded = json.load(f)
        if loaded.get("date") != today:
            # New day — preserve rolling EMAs, reset daily counters
            _state = {
                "date": today,
                "restarts_today": 0,
                "shim_crashes_today": 0,
                "recovery_attempts_today": 0,
                "recovery_successes_today": 0,
                "recovery_success_rate_ema": loaded.get("recovery_success_rate_ema", 1.0),
                "startup_ms_ema": loaded.get("startup_ms_ema"),
                "cache_hit_rate_ema": loaded.get("cache_hit_rate_ema", 0.0),
                "tool_response_ms_ema": loaded.get("tool_response_ms_ema"),
                "circuit_breaker_trips": {},
            }
        else:
            _state = loaded
    except (FileNotFoundError, json.JSONDecodeError):
        _state = {
            "date": today,
            "restarts_today": 0,
            "shim_crashes_today": 0,
            "recovery_attempts_today": 0,
            "recovery_successes_today": 0,
            "recovery_success_rate_ema": 1.0,
            "startup_ms_ema": None,
            "cache_hit_rate_ema": 0.0,
            "tool_response_ms_ema": None,
            "circuit_breaker_trips": {},
        }
    _state["restarts_today"] = _state.get("restarts_today", 0) + 1
    _state["last_restart"] = time.time()
    _state["session_start"] = time.time()
    _save_unlocked()
    logger.info(
        f"HME ops: restart #{_state['restarts_today']} today | "
        f"recovery_rate={_state.get('recovery_success_rate_ema', 1.0):.0%} | "
        f"shim_crashes_today={_state.get('shim_crashes_today', 0)}"
    )
    return dict(_state)


def _save_unlocked() -> None:
    if not _STATE_FILE:
        return
    try:
        tmp = _STATE_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(_state, f, indent=2, default=str)
        os.replace(tmp, _STATE_FILE)  # atomic on POSIX
    except OSError as e:
        logger.warning(f"ops state save failed: {e}")


def snapshot() -> dict:
    with _state_lock:
        return dict(_state)


def get(key: str, default=None):
    with _state_lock:
        return _state.get(key, default)


def increment(key: str, amount: int = 1) -> int:
    with _state_lock:
        _state[key] = _state.get(key, 0) + amount
        _save_unlocked()
        return _state[key]


def set_val(key: str, value) -> None:
    with _state_lock:
        _state[key] = value
        _save_unlocked()


def update_ema(key: str, value: float, alpha: float = _EMA_ALPHA) -> float:
    """Update an exponential moving average metric. Returns the new EMA."""
    with _state_lock:
        current = _state.get(key)
        new_val = value if current is None else alpha * value + (1 - alpha) * current
        _state[key] = round(new_val, 3)
        _save_unlocked()
        return new_val


def record_recovery(succeeded: bool) -> None:
    """Record a recovery attempt outcome; update EMA success rate."""
    with _state_lock:
        _state["recovery_attempts_today"] = _state.get("recovery_attempts_today", 0) + 1
        if succeeded:
            _state["recovery_successes_today"] = _state.get("recovery_successes_today", 0) + 1
        ema = _state.get("recovery_success_rate_ema", 1.0)
        _state["recovery_success_rate_ema"] = round(
            _EMA_ALPHA * (1.0 if succeeded else 0.0) + (1 - _EMA_ALPHA) * ema, 3
        )
        _save_unlocked()


def record_startup_ms(elapsed_ms: float) -> None:
    with _state_lock:
        ema = _state.get("startup_ms_ema")
        _state["startup_ms_ema"] = round(
            elapsed_ms if ema is None else _EMA_ALPHA * elapsed_ms + (1 - _EMA_ALPHA) * ema, 1
        )
        _save_unlocked()


def record_shim_crash() -> None:
    with _state_lock:
        _state["shim_crashes_today"] = _state.get("shim_crashes_today", 0) + 1
        _save_unlocked()


def is_crash_loop() -> bool:
    """Return True if shim crash frequency suggests a crash loop this session.

    Layer 5 (Temporal Rhythm): used to skip expensive startup steps when the
    system is clearly in trouble — don't waste time on Ollama priming if the
    shim crashes every 2 minutes.
    """
    with _state_lock:
        shim_crashes = _state.get("shim_crashes_today", 0)
        restarts = _state.get("restarts_today", 1)
        return shim_crashes >= 3 or restarts >= 8
