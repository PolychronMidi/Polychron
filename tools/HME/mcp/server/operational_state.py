"""HME persistent operational memory — Layer 2 of the self-coherence stack.

Tracks system health metrics that survive across MCP server restarts:
  - restart count per day
  - recovery success/failure rate (EMA)
  - shim crash frequency
  - startup timing EMA
  - cache hit rate EMA
  - circuit breaker trip history + flap detection (L21)
  - synthesis routing + quality gate EMAs (L19)

Written atomically to $PROJECT_ROOT/tmp/hme-ops.json on every state change.
Read on startup; per-day counters reset on new calendar day while preserving
rolling EMAs so long-term trends survive day boundaries.

Layer 5 (Temporal Rhythm) reads is_crash_loop() and restarts_today to adapt
the startup chain aggressiveness. Layer 7 (Predictive Health) updates EMAs here.
Layer 19 (Synthesis Observability) records routing decisions + quality outcomes.
Layer 21 (CB Flap Detection) tracks HALF_OPEN→OPEN transitions per model.
"""
import json
import os
import time
import threading
import logging

logger = logging.getLogger("HME")

_STATE_FILE: str = ""
_SYNTHESIS_FILE: str = ""  # hme-synthesis.jsonl path set in init()
_state: dict = {}
_state_lock = threading.Lock()
_EMA_ALPHA = 0.2  # exponential moving average decay for rolling metrics


def init(project_root: str) -> dict:
    """Initialize operational state from disk. Returns the loaded state snapshot.

    Increments restarts_today; preserves EMAs and long-term metrics across day boundaries.
    Safe to call multiple times — subsequent calls are no-ops (STATE_FILE already set).
    """
    global _STATE_FILE, _SYNTHESIS_FILE, _state
    if _STATE_FILE:
        return snapshot()  # already initialized
    _STATE_FILE = os.path.join(project_root, "tmp", "hme-ops.json")
    _SYNTHESIS_FILE = os.path.join(project_root, "metrics", "hme-synthesis.jsonl")
    os.makedirs(os.path.dirname(_STATE_FILE), exist_ok=True)
    os.makedirs(os.path.dirname(_SYNTHESIS_FILE), exist_ok=True)
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
                "circuit_breaker_flaps": {},
                # L19: synthesis routing EMAs persist across days (long-term behavior)
                "synthesis_calls_today": 0,
                "synthesis_cascade_rate_ema": loaded.get("synthesis_cascade_rate_ema", 0.0),
                "synthesis_quality_gate_ema": loaded.get("synthesis_quality_gate_ema", 0.0),
                "synthesis_escalation_rate_ema": loaded.get("synthesis_escalation_rate_ema", 0.0),
                "synthesis_phantom_rate_ema": loaded.get("synthesis_phantom_rate_ema", 0.0),
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
            "circuit_breaker_flaps": {},
            "synthesis_calls_today": 0,
            "synthesis_cascade_rate_ema": 0.0,
            "synthesis_quality_gate_ema": 0.0,
            "synthesis_escalation_rate_ema": 0.0,
            "synthesis_phantom_rate_ema": 0.0,
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
    """Return True if shim crash frequency suggests a crash loop.

    Layer 5 (Temporal Rhythm): used to skip expensive startup steps when the
    system is clearly in trouble — don't waste time on Ollama priming if the
    shim crashes every 2 minutes.

    MCP restarts are routine (~70/day from Claude Code kill/restart cycle).
    Only shim crashes and rapid restart velocity indicate real trouble.
    """
    with _state_lock:
        shim_crashes = _state.get("shim_crashes_today", 0)
        if shim_crashes >= 3:
            return True
        # Rapid restart velocity: 5+ restarts in the last 10 minutes
        session_start = _state.get("session_start", 0)
        last_restart = _state.get("last_restart", 0)
        restarts = _state.get("restarts_today", 1)
        if restarts >= 5 and session_start and last_restart:
            elapsed_min = (last_restart - session_start) / 60
            if elapsed_min > 0 and restarts / elapsed_min > 0.5:
                return True
        return False


def record_circuit_breaker_trip(model: str) -> int:
    """Record a circuit breaker opening for a model. Returns total trips for this model today.

    Layer 2: persists circuit breaker state across MCP restarts so operational memory
    reflects Ollama instability that predates the current process.
    """
    with _state_lock:
        trips = _state.setdefault("circuit_breaker_trips", {})
        trips[model] = trips.get(model, 0) + 1
        _state["circuit_breaker_trips_total_today"] = sum(trips.values())
        _save_unlocked()
        return trips[model]


def record_circuit_breaker_flap(model: str) -> int:
    """Record a HALF_OPEN → OPEN flap for a model (probe fired but failed immediately).

    Layer 21: Flapping is distinct from steady-state OPEN — it means Ollama is partially
    available but too unstable for recovery. Tracked separately from trips so the
    L14 correlator can detect sustained instability vs one-time outages.
    """
    with _state_lock:
        flaps = _state.setdefault("circuit_breaker_flaps", {})
        flaps[model] = flaps.get(model, 0) + 1
        _state["circuit_breaker_flaps_total_today"] = sum(flaps.values())
        _save_unlocked()
        return flaps[model]


def record_synthesis_call(strategy: str, used_cascade: bool, escalated: bool,
                          quality_gate_fired: bool, phantom_count: int,
                          verified_count: int, elapsed_s: float,
                          prompt_head: str = "") -> None:
    """Record synthesis routing + quality outcome. Layer 19: Synthesis Observability.

    Updates EMAs for cascade rate, quality gate rate, escalation rate, and phantom rate.
    Appends a structured record to hme-synthesis.jsonl for L14 Correlator pattern detection.
    """
    phantom_rate = phantom_count / max(phantom_count + verified_count, 1) if quality_gate_fired else 0.0
    with _state_lock:
        _state["synthesis_calls_today"] = _state.get("synthesis_calls_today", 0) + 1
        a = _EMA_ALPHA
        _state["synthesis_cascade_rate_ema"] = round(
            a * (1.0 if used_cascade else 0.0) + (1 - a) * _state.get("synthesis_cascade_rate_ema", 0.0), 3)
        _state["synthesis_quality_gate_ema"] = round(
            a * (1.0 if quality_gate_fired else 0.0) + (1 - a) * _state.get("synthesis_quality_gate_ema", 0.0), 3)
        _state["synthesis_escalation_rate_ema"] = round(
            a * (1.0 if escalated else 0.0) + (1 - a) * _state.get("synthesis_escalation_rate_ema", 0.0), 3)
        _state["synthesis_phantom_rate_ema"] = round(
            a * phantom_rate + (1 - a) * _state.get("synthesis_phantom_rate_ema", 0.0), 3)
        _save_unlocked()
    if _SYNTHESIS_FILE:
        try:
            entry = json.dumps({
                "ts": time.time(),
                "strategy": strategy,
                "used_cascade": used_cascade,
                "escalated": escalated,
                "quality_gate_fired": quality_gate_fired,
                "phantom_count": phantom_count,
                "verified_count": verified_count,
                "phantom_rate": round(phantom_rate, 3) if quality_gate_fired else None,
                "elapsed_s": round(elapsed_s, 1),
                "prompt_head": prompt_head[:60],
            })
            with open(_SYNTHESIS_FILE, "a") as f:
                f.write(entry + "\n")
            _trim_synthesis_file()
        except OSError as e:
            logger.debug(f"ops: synthesis log write failed: {e}")


def _trim_synthesis_file() -> None:
    """Keep hme-synthesis.jsonl bounded at 1000 entries."""
    if not _SYNTHESIS_FILE:
        return
    try:
        with open(_SYNTHESIS_FILE) as f:
            lines = f.readlines()
        if len(lines) > 1000:
            with open(_SYNTHESIS_FILE, "w") as f:
                f.writelines(lines[-1000:])
    except OSError:
        pass
