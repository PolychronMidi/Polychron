"""HME meta-observer Layer 14 — Temporal Correlator (pure computation).

Accepts a pre-loaded coherence history list and ops dict; no file I/O or
global state. Called by meta_observer._correlate() after loading history.
"""
import logging

logger = logging.getLogger("HME")

_ALERT_LOG_COOLDOWN = 300  # seconds between repeated alert log lines


def correlate(
    history: list[dict],
    ops: dict,
    correlation_window: int,
    synthesis_history: list[dict] | None = None,
) -> dict:
    """Pure temporal correlator — no file I/O, accepts pre-loaded data.

    Args:
        history: List of coherence entries (each has 'coherence', 'shim_ms', 'ts').
        ops: Current ops state dict (from hme-ops.json).
        correlation_window: Window in seconds used to label the result.
        synthesis_history: Optional list of synthesis call records (L19/L20).

    Returns:
        Correlation result dict with 'status', metrics, and 'alerts' list.
    """
    if len(history) < 3:
        return {"status": "insufficient_data", "samples": len(history)}

    coherence_values = [e.get("coherence", 0.0) for e in history]
    shim_ms_values = [e.get("shim_ms") for e in history if e.get("shim_ms") is not None]

    avg_coherence = sum(coherence_values) / len(coherence_values)
    min_coherence = min(coherence_values)
    max_coherence = max(coherence_values)
    recent_5 = coherence_values[-5:] if len(coherence_values) >= 5 else coherence_values
    trend = (sum(recent_5) / len(recent_5)) - avg_coherence

    result: dict = {
        "status": "active",
        "samples": len(history),
        "window_s": correlation_window,
        "coherence_avg": round(avg_coherence, 3),
        "coherence_min": round(min_coherence, 3),
        "coherence_max": round(max_coherence, 3),
        "coherence_trend": round(trend, 3),
        "alerts": [],
    }

    if trend < -0.1:
        result["alerts"].append({
            "type": "coherence_declining",
            "message": f"Coherence trending down ({trend:+.3f} from mean) — degradation likely",
        })

    if min_coherence < 0.3:
        result["alerts"].append({
            "type": "deep_degradation",
            "message": f"Coherence hit {min_coherence:.0%} in last hour — system was severely impaired",
        })

    # Shim latency correlation
    if len(shim_ms_values) >= 5:
        avg_ms = sum(shim_ms_values) / len(shim_ms_values)
        recent_ms = sum(shim_ms_values[-3:]) / 3
        if recent_ms > avg_ms * 2 and recent_ms > 500:
            result["alerts"].append({
                "type": "shim_latency_spike",
                "message": f"Shim latency rising ({recent_ms:.0f}ms vs {avg_ms:.0f}ms avg) — precursor to crash",
            })
        result["shim_ms_avg"] = round(avg_ms, 1)
        result["shim_ms_recent"] = round(recent_ms, 1)

    # Dip frequency
    dips = sum(1 for c in coherence_values if c < 0.7)
    if dips > 0:
        result["dip_count"] = dips
        result["dip_rate_per_hour"] = round(dips / (correlation_window / 3600), 1)
        if dips >= 5:
            result["alerts"].append({
                "type": "frequent_instability",
                "message": f"{dips} coherence dips (<0.7) in last hour — systemic instability",
            })

    # Ops cross-reference
    restarts = ops.get("restarts_today", 0)
    shim_crashes = ops.get("shim_crashes_today", 0)
    recent_ms_val = result.get("shim_ms_recent", 0)
    if restarts >= 5 and min_coherence < 0.5:
        result["alerts"].append({
            "type": "restart_churn",
            "message": f"{restarts} MCP restarts today with coherence dips — crash loop pattern",
        })
    if shim_crashes >= 2 and len(shim_ms_values) >= 5 and recent_ms_val > 1000:
        result["alerts"].append({
            "type": "shim_decay_precursor",
            "message": f"{shim_crashes} shim crashes + rising latency — next crash imminent",
        })

    # L21: circuit breaker flap detection
    flaps = ops.get("circuit_breaker_flaps", {})
    flap_total = ops.get("circuit_breaker_flaps_total_today", 0)
    if flap_total >= 3:
        flap_models = [f"{m}×{n}" for m, n in flaps.items() if n >= 2]
        result["alerts"].append({
            "type": "cb_flapping",
            "message": (
                f"Circuit breaker flapping ({flap_total} HALF_OPEN→OPEN today"
                + (f": {', '.join(flap_models)}" if flap_models else "")
                + ") — model recovering but unstable, possible GPU thrash"
            ),
        })

    # L19/L20: synthesis quality correlation
    synth_calls = ops.get("synthesis_calls_today", 0)
    if synth_calls >= 5:
        phantom_ema = ops.get("synthesis_phantom_rate_ema", 0.0)
        gate_ema = ops.get("synthesis_quality_gate_ema", 0.0)
        escalation_ema = ops.get("synthesis_escalation_rate_ema", 0.0)
        result["synthesis_calls_today"] = synth_calls
        result["synthesis_phantom_rate_ema"] = phantom_ema
        result["synthesis_cascade_rate_ema"] = ops.get("synthesis_cascade_rate_ema", 0.0)
        if phantom_ema > 0.4:
            result["alerts"].append({
                "type": "synthesis_phantom_surge",
                "message": (
                    f"Synthesis phantom rate {phantom_ema:.0%} EMA — module grounding degraded. "
                    "Fuzzy discovery may be missing relevant modules or source files moved."
                ),
            })
        if escalation_ema > 0.3:
            result["alerts"].append({
                "type": "synthesis_escalation_high",
                "message": (
                    f"Synthesis escalation rate {escalation_ema:.0%} EMA — primary model "
                    "failing frequently. Check circuit breaker state and GPU availability."
                ),
            })

    return result
