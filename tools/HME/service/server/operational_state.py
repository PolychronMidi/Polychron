"""HME persistent operational memory -- Layer 2 of the self-coherence stack.

Tracks system health metrics that survive across MCP server restarts:
  - restart count per day
  - recovery success/failure rate (EMA)
  - shim crash frequency
  - startup timing EMA
  - cache hit rate EMA
  - circuit breaker trip history + flap detection (L21)
  - synthesis routing + quality gate EMAs (L19)
  - multi-timescale coherence EMAs (L23)
  - prediction accuracy / Brier score EMA (L29)
  - session identity documents (L30)
  - thermodynamic efficiency metrics (L34)

Written atomically to $PROJECT_ROOT/tmp/hme-ops.json on every state change.
Read on startup; per-day counters reset on new calendar day while preserving
rolling EMAs so long-term trends survive day boundaries.

Layer 5 (Temporal Rhythm) reads is_crash_loop() and restarts_today to adapt
the startup chain aggressiveness. Layer 7 (Predictive Health) updates EMAs here.
Layer 19 (Synthesis Observability) records routing decisions + quality outcomes.
Layer 21 (CB Flap Detection) tracks HALF_OPEN->OPEN transitions per model.
Layer 23 (Multi-Timescale) maintains coherence EMAs at beat/phrase/section/structure scales.
Layer 29 (Second-Order Accuracy) tracks Brier score of prediction calibration.
Layer 34 (Thermodynamic) models information-theoretic efficiency of synthesis.
"""
import json
import os
import time
import threading
import logging

from hme_env import ENV
from paths import hme_metric

logger = logging.getLogger("HME")

_STATE_FILE: str = ""
_SYNTHESIS_FILE: str = ""  # hme-synthesis.jsonl path set in init()
_SESSIONS_FILE: str = ""   # hme-sessions.jsonl path set in init() (L30)
_state: dict = {}
_state_lock = threading.Lock()
_EMA_ALPHA = 0.2  # exponential moving average decay for rolling metrics

# L23: multi-timescale EMA alphas (beat=fast, structure=glacial)
_ALPHA_BEAT = 0.8
_ALPHA_PHRASE = 0.3
_ALPHA_SECTION = 0.1
_ALPHA_STRUCTURE = 0.05


def init(project_root: str) -> dict:
    """Initialize operational state from disk. Returns the loaded state snapshot.

    Increments restarts_today; preserves EMAs and long-term metrics across day boundaries.
    Safe to call multiple times -- subsequent calls are no-ops (STATE_FILE already set).
    """
    global _STATE_FILE, _SYNTHESIS_FILE, _SESSIONS_FILE, _state
    if _STATE_FILE:
        return snapshot()  # already initialized
    _STATE_FILE = os.path.join(project_root, "tmp", "hme-ops.json")
    _SYNTHESIS_FILE = hme_metric("hme-synthesis.jsonl")
    _SESSIONS_FILE = hme_metric("hme-sessions.jsonl")
    os.makedirs(os.path.dirname(_STATE_FILE), exist_ok=True)
    os.makedirs(os.path.dirname(_SYNTHESIS_FILE), exist_ok=True)
    today = time.strftime("%Y-%m-%d")
    try:
        with open(_STATE_FILE) as f:
            loaded = json.load(f)
        if loaded.get("date") != today:
            # New day -- preserve rolling EMAs, reset daily counters
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
                # L23: multi-timescale coherence EMAs persist across days
                "coherence_beat_ema": loaded.get("coherence_beat_ema"),
                "coherence_phrase_ema": loaded.get("coherence_phrase_ema"),
                "coherence_section_ema": loaded.get("coherence_section_ema"),
                "coherence_structure_ema": loaded.get("coherence_structure_ema"),
                # L29: prediction accuracy Brier score
                "brier_score_ema": loaded.get("brier_score_ema"),
                "prediction_outcomes_today": 0,
                # L34: thermodynamic efficiency
                "thermo_efficiency_ema": loaded.get("thermo_efficiency_ema"),
                "thermo_entropy_ema": loaded.get("thermo_entropy_ema"),
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
            "coherence_beat_ema": None,
            "coherence_phrase_ema": None,
            "coherence_section_ema": None,
            "coherence_structure_ema": None,
            "brier_score_ema": None,
            "prediction_outcomes_today": 0,
            "thermo_efficiency_ema": None,
            "thermo_entropy_ema": None,
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


_LATENCY_EXCLUDED_TOOLS = {"hme_admin", "hme_selftest", "hme_hot_reload"}


def record_tool_response(name: str, elapsed_ms: float) -> float | None:
    """Record interactive tool latency; skip maintenance/admin probes."""
    with _state_lock:
        _state["tool_response_ms_last_tool"] = name
        _state["tool_response_ms_last_ms"] = round(elapsed_ms, 3)
        _state["tool_response_ms_last_ts"] = time.time()
        if name in _LATENCY_EXCLUDED_TOOLS:
            _state["tool_response_ms_last_skipped"] = name
            _save_unlocked()
            return _state.get("tool_response_ms_ema")
        current = _state.get("tool_response_ms_ema")
        new_val = elapsed_ms if current is None else _EMA_ALPHA * elapsed_ms + (1 - _EMA_ALPHA) * current
        _state["tool_response_ms_ema"] = round(new_val, 3)
        _state["tool_response_ms_last_recorded"] = name
        _save_unlocked()
        return new_val


def repair_tool_response_ema(value: float, reason: str) -> None:
    """Approved repair path for polluted tool-latency EMA state."""
    with _state_lock:
        _state["tool_response_ms_ema"] = round(float(value), 3)
        _state["tool_response_ms_repair"] = {"ts": time.time(), "reason": reason}
        _save_unlocked()


# Re-exports -- recovery/derived stats extracted.
from .operational_state_recovery import record_recovery, record_startup_ms, record_shim_crash, is_crash_loop, record_circuit_breaker_trip, record_circuit_breaker_flap, record_synthesis_call, _trim_synthesis_file, record_coherence_multiscale, get_multiscale_coherence, is_coherence_ceiling, record_prediction_brier, write_session_document, load_recent_sessions, _trim_sessions_file, record_thermodynamic  # noqa: F401, E402
