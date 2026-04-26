"""Layer 20+: session archaeology, unprovable claims, coherence ceiling."""
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


def _session_archaeology() -> dict | None:
    """Mine session identity documents for cross-session behavioral patterns.

    Detects: coherence degradation in long sessions, time-of-day effects,
    phantom rate trends across days, session duration clustering.
    """
    try:
        from server import operational_state
        sessions = operational_state.load_recent_sessions(max_age_days=7)
    except Exception as _err:
        logger.debug(f"unnamed-except meta_observer.py:1294: {type(_err).__name__}: {_err}")
        return None

    if len(sessions) < 5:
        return None

    durations = [s.get("session_duration_s", 0) for s in sessions if s.get("session_duration_s")]
    phantom_rates = [s.get("synthesis_phantom_rate_ema", 0) for s in sessions
                     if s.get("synthesis_phantom_rate_ema") is not None]
    coherences = [s.get("coherence_phrase_ema", 0) for s in sessions
                  if s.get("coherence_phrase_ema") is not None]

    result = {"sessions_analyzed": len(sessions)}

    if durations:
        result["avg_session_duration_s"] = round(sum(durations) / len(durations), 1)
        long_sessions = [d for d in durations if d > 3600]
        result["long_sessions_pct"] = round(len(long_sessions) / len(durations), 2)

    if phantom_rates:
        result["avg_phantom_rate"] = round(sum(phantom_rates) / len(phantom_rates), 3)
        # Trend: compare first half to second half
        mid = len(phantom_rates) // 2
        if mid > 0:
            first_half = sum(phantom_rates[:mid]) / mid
            second_half = sum(phantom_rates[mid:]) / len(phantom_rates[mid:])
            result["phantom_trend"] = round(second_half - first_half, 3)

    if coherences:
        result["avg_coherence"] = round(sum(coherences) / len(coherences), 3)

    # Detect: do long sessions have worse coherence?
    if len(sessions) >= 8:
        long = [s for s in sessions if (s.get("session_duration_s") or 0) > 1800]
        short = [s for s in sessions if (s.get("session_duration_s") or 0) <= 1800]
        if long and short:
            long_coh = sum(s.get("coherence_phrase_ema") or 0.5 for s in long) / len(long)
            short_coh = sum(s.get("coherence_phrase_ema") or 0.5 for s in short) / len(short)
            if long_coh < short_coh - 0.1:
                result["finding"] = f"long sessions degrade coherence ({long_coh:.2f} vs {short_coh:.2f})"

    return result


# Layer 35: Gödel Awareness

_UNPROVABLE_CLAIMS = [
    {
        "claim": "Quality gate catches the right module references",
        "reason": "No ground truth about which modules SHOULD be referenced in a given answer",
        "validation": "external_listening",
    },
    {
        "claim": "Phantom detection doesn't itself introduce phantom detections",
        "reason": "Self-referentially unprovable — the detector can't validate its own false positive rate",
        "validation": "chaos_testing",
    },
    {
        "claim": "Coherence score measures actual system coherence",
        "reason": "Coherence is computed from its own inputs — circular validation",
        "validation": "external_audit",
    },
    {
        "claim": "KB entries describe what the code actually does",
        "reason": "KB entries are static text; code evolves independently",
        "validation": "contradict_scan",
    },
    {
        "claim": "EMA alphas are well-tuned for the actual signal dynamics",
        "reason": "Alpha values were chosen a priori, not derived from observed autocorrelation",
        "validation": "sensitivity_analysis",
    },
    {
        "claim": "Causal attribution correctly identifies root causes",
        "reason": "Correlation-based attribution cannot distinguish causation from confounding",
        "validation": "controlled_experiment",
    },
]


def _enumerate_unprovable_claims() -> list[dict]:
    """Return the system's known Gödelian blind spots.

    These are statements the self-model makes that cannot be verified from
    within the system. They become targets for external validation.
    """
    claims = list(_UNPROVABLE_CLAIMS)
    # Dynamic: check if any recent synthesis patterns have untestable aspects
    try:
        if os.path.exists(_shared._ms.synthesis_patterns_file):
            with open(_shared._ms.synthesis_patterns_file) as f:
                patterns = json.load(f)
            if patterns.get("quality_gate_rate", 0) > 0 and patterns.get("total_calls_analyzed", 0) > 50:
                claims.append({
                    "claim": f"Quality gate fires at the right rate ({patterns['quality_gate_rate']:.0%})",
                    "reason": "Optimal gate rate unknown — too high = false alarms, too low = missed phantoms",
                    "validation": "A/B_comparison",
                })
    except (OSError, json.JSONDecodeError) as _pat_err:
        # Synthesis-patterns read failure = quality-gate claim silently
        # missing from the reflexivity report. Register as CRITICAL so
        # the LIFESAVER banner surfaces observability loss on the very
        # next tool response — not left to be noticed via "report looks healthy."
        logger.error(f"synthesis_patterns read FAILED: {type(_pat_err).__name__}: {_pat_err}")
        try:
            from server import context as _ctx
            _ctx.register_critical_failure(
                "meta_layers.synthesis_patterns",
                f"synthesis_patterns.json unreadable ({type(_pat_err).__name__}); quality-gate claim dropped from reflexivity report",
                severity="CRITICAL",
            )
        except Exception as _life_err:
            logger.debug(f"LIFESAVER register failed: {_life_err}")
    return claims


# Layer ∞∞: Coherence Ceiling Detector

def _check_coherence_ceiling() -> dict | None:
    """Detect when the self-model's predictions have become too reliable to
    generate learning signal.

    Uses the Brier-score EMA (L29) as the ground-truth calibration signal:
    predictions that resolve near their predicted probability drive Brier
    toward 0. When Brier EMA < 0.05 with ≥10 resolved predictions today,
    the system has effectively memorized its own behavior space and can't
    learn anything new without a perturbation.

    Previously wired to the shim-health multi-scale EMAs, which saturated
    at 1.0 trivially and fired false positives ~constantly. See
    operational_state.is_coherence_ceiling() for the rationale.
    """
    try:
        from server import operational_state
        if not operational_state.is_coherence_ceiling():
            return None
        state_snapshot = operational_state.get_state()
        brier = state_snapshot.get("brier_score") if isinstance(state_snapshot, dict) else None
        outcomes = None
        try:
            with operational_state._state_lock:  # type: ignore[attr-defined]
                outcomes = operational_state._state.get("prediction_outcomes_today")  # type: ignore[attr-defined]
        except AttributeError:  # silent-ok: reflexivity claim skip; reader tolerates missing claim gracefully
            pass
        return {
            "ceiling_hit": True,
            "brier_score_ema": brier,
            "prediction_outcomes_today": outcomes,
            "recommendation": (
                f"Brier score EMA {brier} over {outcomes} predictions today — "
                "predictions are saturating. Self-model may be over-fit. "
                "Consider: explore under-modeled operational states, "
                "try synthesis strategies not used recently, "
                "make predictions with explicit low confidence to gain calibration signal."
            ),
        }
    except Exception as _err:
        logger.debug(f"unnamed-except meta_observer.py:1421: {type(_err).__name__}: {_err}")
        return None


