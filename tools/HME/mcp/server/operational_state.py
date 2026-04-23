"""HME persistent operational memory — Layer 2 of the self-coherence stack.

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
Layer 21 (CB Flap Detection) tracks HALF_OPEN→OPEN transitions per model.
Layer 23 (Multi-Timescale) maintains coherence EMAs at beat/phrase/section/structure scales.
Layer 29 (Second-Order Accuracy) tracks Brier score of prediction calibration.
Layer 34 (Thermodynamic) models information-theoretic efficiency of synthesis.
"""
import json
import os
import time
import threading
import logging

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
    Safe to call multiple times — subsequent calls are no-ops (STATE_FILE already set).
    """
    global _STATE_FILE, _SYNTHESIS_FILE, _SESSIONS_FILE, _state
    if _STATE_FILE:
        return snapshot()  # already initialized
    _STATE_FILE = os.path.join(project_root, "tmp", "hme-ops.json")
    _SYNTHESIS_FILE = os.path.join(os.environ.get("METRICS_DIR", os.path.join(project_root, "output", "metrics")), "hme-synthesis.jsonl")
    _SESSIONS_FILE = os.path.join(os.environ.get("METRICS_DIR", os.path.join(project_root, "output", "metrics")), "hme-sessions.jsonl")
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
    system is clearly in trouble — don't waste time on llama.cpp priming if the
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
    reflects llama.cpp instability that predates the current process.
    """
    with _state_lock:
        trips = _state.setdefault("circuit_breaker_trips", {})
        trips[model] = trips.get(model, 0) + 1
        _state["circuit_breaker_trips_total_today"] = sum(trips.values())
        _save_unlocked()
        return trips[model]


def record_circuit_breaker_flap(model: str) -> int:
    """Record a HALF_OPEN → OPEN flap for a model (probe fired but failed immediately).

    Layer 21: Flapping is distinct from steady-state OPEN — it means llama.cpp is partially
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
    except OSError:  # silent-ok: synthesis-log trim; failure defers compaction one cycle
        pass


# Layer 23: Multi-Timescale Coherence

def record_coherence_multiscale(coherence: float) -> dict:
    """Update coherence EMAs at all four timescales. Returns the current multi-scale snapshot.

    Beat (α=0.8): reacts within 2-3 samples — captures per-call quality.
    Phrase (α=0.3): smooths over ~10 samples — session health trend.
    Section (α=0.1): smooths over ~30 samples — daily operational rhythm.
    Structure (α=0.05): smooths over ~60 samples — weekly drift detection.
    """
    with _state_lock:
        for key, alpha in [
            ("coherence_beat_ema", _ALPHA_BEAT),
            ("coherence_phrase_ema", _ALPHA_PHRASE),
            ("coherence_section_ema", _ALPHA_SECTION),
            ("coherence_structure_ema", _ALPHA_STRUCTURE),
        ]:
            cur = _state.get(key)
            _state[key] = round(coherence if cur is None else alpha * coherence + (1 - alpha) * cur, 4)
        _save_unlocked()
        return {
            "beat": _state.get("coherence_beat_ema"),
            "phrase": _state.get("coherence_phrase_ema"),
            "section": _state.get("coherence_section_ema"),
            "structure": _state.get("coherence_structure_ema"),
        }


def get_multiscale_coherence() -> dict:
    with _state_lock:
        return {
            "beat": _state.get("coherence_beat_ema"),
            "phrase": _state.get("coherence_phrase_ema"),
            "section": _state.get("coherence_section_ema"),
            "structure": _state.get("coherence_structure_ema"),
        }


def is_coherence_ceiling() -> bool:
    """L∞∞: detect when the system's predictions are too perfect to generate
    learning signal — i.e. the Brier score EMA has stayed near zero long
    enough that novel inputs are no longer perturbing the self-model.

    Historically this was wired to the shim-health multi-scale coherence
    EMAs, which trivially saturate at 1.0 whenever the shim is stable —
    producing spurious "over-modeled" warnings on a perfectly-ordinary
    healthy process. Brier score is the real "am I predicting too well"
    signal: it's derived from resolved predictions, so it only saturates
    when the self-model is genuinely out of novelty.

    Fires only when BOTH:
      - brier_score_ema is defined and < 0.05 (near-perfect predictions)
      - prediction_outcomes_today >= 10 (enough samples to be meaningful)
    """
    with _state_lock:
        brier = _state.get("brier_score_ema")
        outcomes = _state.get("prediction_outcomes_today") or 0
        if brier is None or outcomes < 10:
            return False
        return brier < 0.05


# Layer 29: Prediction Accuracy (Brier Score)

def record_prediction_brier(predicted_prob: float, occurred: bool) -> float:
    """Record a prediction outcome via Brier score: (predicted_prob - actual)².

    Returns the updated Brier score EMA. Lower = better calibrated (0.0 = perfect).
    """
    brier = (predicted_prob - (1.0 if occurred else 0.0)) ** 2
    with _state_lock:
        cur = _state.get("brier_score_ema")
        _state["brier_score_ema"] = round(
            brier if cur is None else _EMA_ALPHA * brier + (1 - _EMA_ALPHA) * cur, 4
        )
        _state["prediction_outcomes_today"] = _state.get("prediction_outcomes_today", 0) + 1
        _save_unlocked()
        return _state["brier_score_ema"]


# Layer 30: Session Identity Document

def write_session_document() -> None:
    """Persist this session's identity + trajectory to hme-sessions.jsonl.

    Called on shutdown or periodically. New sessions read prior documents to detect
    cross-session behavioral patterns (coherence degradation in long sessions,
    time-of-day effects, phantom rate correlations with run outcomes).
    """
    if not _SESSIONS_FILE:
        return
    with _state_lock:
        synth_calls = _state.get("synthesis_calls_today", 0)
        doc = {
            "session_start": _state.get("session_start"),
            "session_end": time.time(),
            "date": _state.get("date"),
            "restarts_today": _state.get("restarts_today", 0),
            "synthesis_calls": synth_calls,
            # Synthesis quality metrics only valid when synthesis was actually used
            "synthesis_phantom_rate_ema": _state.get("synthesis_phantom_rate_ema") if synth_calls > 0 else None,
            "synthesis_cascade_rate_ema": _state.get("synthesis_cascade_rate_ema") if synth_calls > 0 else None,
            "coherence_phrase_ema": _state.get("coherence_phrase_ema"),
            "coherence_section_ema": _state.get("coherence_section_ema"),
            "cb_flaps": _state.get("circuit_breaker_flaps_total_today", 0),
            "cb_trips": _state.get("circuit_breaker_trips_total_today", 0),
            "shim_crashes": _state.get("shim_crashes_today", 0),
            "recovery_rate": _state.get("recovery_success_rate_ema"),
            "brier_score": _state.get("brier_score_ema"),
            "thermo_efficiency": _state.get("thermo_efficiency_ema") if synth_calls > 0 else None,
        }
        session_start = _state.get("session_start") or time.time()
        doc["session_duration_s"] = round(time.time() - session_start, 1)
    try:
        with open(_SESSIONS_FILE, "a") as f:
            f.write(json.dumps(doc) + "\n")
        _trim_sessions_file()
    except OSError as e:
        logger.debug(f"ops: session document write failed: {e}")


def load_recent_sessions(max_age_days: int = 7) -> list[dict]:
    """Load session documents from the last N days for cross-session pattern detection."""
    if not _SESSIONS_FILE:
        return []
    cutoff = time.time() - max_age_days * 86400
    sessions = []
    try:
        with open(_SESSIONS_FILE) as f:
            for line in f:
                try:
                    doc = json.loads(line.strip())
                    if (doc.get("session_start") or 0) >= cutoff:
                        sessions.append(doc)
                except json.JSONDecodeError:
                    continue
    except OSError:  # silent-ok: sessions-file read fallback; absent/unreadable = empty session list, acceptable
        pass
    return sessions


def _trim_sessions_file() -> None:
    if not _SESSIONS_FILE:
        return
    try:
        with open(_SESSIONS_FILE) as f:
            lines = f.readlines()
        if len(lines) > 500:
            with open(_SESSIONS_FILE, "w") as f:
                f.writelines(lines[-500:])
    except OSError:  # silent-ok: sessions-file trim; failure defers compaction one cycle
        pass


# Layer 34: Thermodynamic Efficiency

def record_thermodynamic(verified: int, phantom: int, elapsed_s: float,
                         cache_hit: bool = False) -> dict:
    """Model synthesis as thermodynamics: efficiency = useful work / total cost.

    Negentropy (cache hits) = free information. Entropy production = phantom generation.
    Efficiency = verified / (verified + phantom + 1) / max(elapsed_s, 0.1).
    Returns dict with current efficiency and entropy EMAs.
    """
    total_refs = verified + phantom
    efficiency = (verified / max(total_refs, 1)) / max(elapsed_s, 0.1) if total_refs > 0 else 0.0
    entropy = phantom / max(total_refs, 1) if total_refs > 0 else 0.0
    if cache_hit:
        efficiency *= 2.0  # negentropy bonus: cache hits double effective efficiency
    with _state_lock:
        for key, val in [("thermo_efficiency_ema", efficiency), ("thermo_entropy_ema", entropy)]:
            cur = _state.get(key)
            _state[key] = round(val if cur is None else _EMA_ALPHA * val + (1 - _EMA_ALPHA) * cur, 4)
        _save_unlocked()
        return {
            "efficiency": _state.get("thermo_efficiency_ema"),
            "entropy": _state.get("thermo_entropy_ema"),
        }
