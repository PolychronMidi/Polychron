"""Layer 17: prediction/resolution, counterfactuals, effectiveness, auto-predictions."""
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


_shared._predictions: list[dict] = []  # active predictions awaiting outcome


def record_prediction(prediction_type: str, predicted_outcome: str,
                      intervention: str | None = None, window_s: float = 600,
                      confidence: float | None = None) -> str:
    """Record a prediction about what will happen. Returns prediction ID.

    confidence: explicit probability that predicted_outcome occurs (0-1).
    If None, defaults to 0.8 (no intervention) or 0.6 (with intervention) for L29 Brier.
    Use low confidence (e.g. 0.1) for baseline/healthy-state predictions of bad outcomes.
    """
    pred_id = f"pred-{int(time.time())}-{len(_shared._predictions)}"
    pred = {
        "id": pred_id,
        "ts": time.time(),
        "type": prediction_type,
        "predicted": predicted_outcome,
        "intervention": intervention,
        "window_s": window_s,
        "deadline": time.time() + window_s,
        "confidence": confidence,
        "outcome": None,
    }
    _shared._predictions.append(pred)
    logger.info(f"Meta-observer L18: prediction {pred_id} — {prediction_type}: "
                f"expecting '{predicted_outcome}' within {window_s}s"
                f"{f', intervening with: {intervention}' if intervention else ''}")
    return pred_id


def resolve_prediction(pred_id: str, outcome_occurred: bool) -> None:
    """Mark a prediction as resolved — did the predicted outcome happen?"""
    for pred in _shared._predictions:
        if pred["id"] == pred_id and pred["outcome"] is None:
            pred["outcome"] = {
                "occurred": outcome_occurred,
                "resolved_ts": time.time(),
                "intervened": pred["intervention"] is not None,
            }
            _write_counterfactual(pred)
            # L29: update Brier score EMA for prediction calibration tracking
            try:
                from server import operational_state
                predicted_prob = (pred["confidence"] if pred.get("confidence") is not None
                                  else (0.8 if pred["intervention"] is None else 0.6))
                operational_state.record_prediction_brier(predicted_prob, outcome_occurred)
            except Exception as _err5:
                logger.debug(f"operational_state.record_prediction_brie: {type(_err5).__name__}: {_err5}")
            verb = "occurred" if outcome_occurred else "was prevented"
            logger.info(f"Meta-observer L18: {pred_id} resolved — predicted outcome {verb}"
                        f"{' (intervention: ' + pred['intervention'] + ')' if pred['intervention'] else ''}")
            return


def _expire_predictions() -> None:
    """Check for predictions past their deadline — if no outcome recorded, assume prevented.

    All predictions are phrased as negative outcomes ('bad thing happens within X').
    Expiry with no explicit resolution means the bad thing was prevented: occurred=False.
    Also updates L29 Brier score so expiry contributes to calibration tracking.
    """
    now = time.time()
    for pred in _shared._predictions:
        if pred["outcome"] is None and now > pred["deadline"]:
            pred["outcome"] = {
                "occurred": False,
                "resolved_ts": now,
                "intervened": pred["intervention"] is not None,
                "auto_expired": True,
            }
            _write_counterfactual(pred)
            # L29: expired predictions count toward Brier — outcome_occurred=False (prevented)
            try:
                from server import operational_state
                predicted_prob = (pred["confidence"] if pred.get("confidence") is not None
                                  else (0.8 if pred["intervention"] is None else 0.6))
                operational_state.record_prediction_brier(predicted_prob, False)
            except Exception as _err6:
                logger.debug(f"operational_state.record_prediction_brie: {type(_err6).__name__}: {_err6}")
    # Prune resolved predictions older than 1 hour
    _shared._predictions[:] = [p for p in _shared._predictions if
                       p["outcome"] is None or
                       time.time() - p["outcome"].get("resolved_ts", 0) < 3600]


def _write_counterfactual(pred: dict) -> None:
    try:
        with open(_shared._ms.counterfactual_file, "a") as f:
            f.write(json.dumps(pred) + "\n")
        _trim_counterfactuals_file()
    except OSError as _cf_err:
        # Counterfactual prediction data feeds Brier calibration scoring.
        # Silent loss = falsely-healthy calibration. Surface via LIFESAVER
        # so the next tool response flags the observability gap explicitly.
        logger.error(f"counterfactual append FAILED: {type(_cf_err).__name__}: {_cf_err}")
        try:
            from server import context as _ctx
            _ctx.register_critical_failure(
                "meta_layers.counterfactual",
                f"counterfactual prediction lost ({type(_cf_err).__name__}); Brier calibration now degraded",
                severity="CRITICAL",
            )
        except Exception as _life_err:
            logger.debug(f"LIFESAVER register failed: {_life_err}")


def _trim_counterfactuals_file(max_lines: int = 2000) -> None:
    try:
        with open(_shared._ms.counterfactual_file) as f:
            lines = f.readlines()
        if len(lines) > max_lines:
            with open(_shared._ms.counterfactual_file, "w") as f:
                f.writelines(lines[-max_lines:])
    except OSError:  # silent-ok: counterfactual-file trim; failure defers compaction one cycle
        pass


def _compute_effectiveness() -> dict:
    """Compute intervention effectiveness from counterfactual history."""
    try:
        if not os.path.exists(_shared._ms.counterfactual_file):
            return {"total_predictions": 0}
        resolved = []
        with open(_shared._ms.counterfactual_file) as f:
            for line in f:
                try:
                    pred = json.loads(line.strip())
                    if pred.get("outcome"):
                        resolved.append(pred)
                except json.JSONDecodeError:
                    continue
        if not resolved:
            return {"total_predictions": 0}

        intervened = [p for p in resolved if p.get("outcome", {}).get("intervened")]
        not_intervened = [p for p in resolved if not p.get("outcome", {}).get("intervened")]

        # Predictions where we intervened and the bad outcome was prevented
        successful_interventions = [p for p in intervened if not p["outcome"]["occurred"]]
        # Predictions where we didn't intervene — how often did the bad thing happen?
        natural_occurrence_rate = (
            sum(1 for p in not_intervened if p["outcome"]["occurred"]) / max(len(not_intervened), 1)
        )

        return {
            "total_predictions": len(resolved),
            "total_interventions": len(intervened),
            "successful_interventions": len(successful_interventions),
            "accuracy": round(len(successful_interventions) / max(len(intervened), 1), 3),
            "natural_occurrence_rate": round(natural_occurrence_rate, 3),
        }
    except OSError:
        return {"total_predictions": 0}


def _detect_synthesis_patterns() -> None:
    """Layer ∞: build a grounding self-model from accumulated synthesis call records.

    After 20+ synthesis calls, identifies per-strategy phantom rates and the most
    common prompt words in quality-gate-triggered calls. Writes findings to
    hme-synthesis-patterns.json for L15 narrator and entanglement context.

    This is the recursive step: the system's synthesis behavior becomes legible
    from data, allowing the narrator to surface actionable grounding guidance.
    """
    if not _shared._ms.synthesis_file or not _shared._ms.synthesis_patterns_file:
        return
    try:
        entries = []
        with open(_shared._ms.synthesis_file) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        if len(entries) < 20:
            return

        # Per-strategy phantom rates
        by_strategy: dict[str, list[float]] = {}
        word_freq: dict[str, int] = {}
        for e in entries:
            strat = e.get("strategy", "unknown")
            pr = e.get("phantom_rate")
            if pr is not None:
                by_strategy.setdefault(strat, []).append(pr)
            # Word frequency in quality-gate-flagged prompts
            if e.get("quality_gate_fired") and pr is not None and pr > 0.5:
                for w in e.get("prompt_head", "").lower().split():
                    if len(w) > 3:
                        word_freq[w] = word_freq.get(w, 0) + 1

        strategy_phantom_rates = {
            s: round(sum(vals) / len(vals), 3)
            for s, vals in by_strategy.items()
            if vals
        }
        top_phantom_words = sorted(word_freq.items(), key=lambda x: -x[1])[:10]

        total = len(entries)
        gate_fired = sum(1 for e in entries if e.get("quality_gate_fired"))
        patterns = {
            "ts": time.time(),
            "total_calls_analyzed": total,
            "quality_gate_rate": round(gate_fired / max(total, 1), 3),
            "strategy_phantom_rates": strategy_phantom_rates,
            "top_phantom_trigger_words": top_phantom_words,
            "cascade_rate": round(sum(1 for e in entries if e.get("used_cascade")) / max(total, 1), 3),
            "escalation_rate": round(sum(1 for e in entries if e.get("escalated")) / max(total, 1), 3),
        }
        tmp = _shared._ms.synthesis_patterns_file + ".tmp"
        with open(tmp, "w") as f:
            json.dump(patterns, f, indent=2)
        os.replace(tmp, _shared._ms.synthesis_patterns_file)
        logger.debug(
            f"Meta-observer L∞: synthesis self-model updated "
            f"({total} calls, gate_rate={patterns['quality_gate_rate']:.0%}, "
            f"top_phantom_words={[w for w, _ in top_phantom_words[:3]]})"
        )
    except (OSError, json.JSONDecodeError) as e:
        logger.debug(f"Meta-observer L∞: pattern detection failed: {e}")


def _auto_predictions_from_correlator() -> None:
    """Generate predictions from L14 correlator alerts — feeding L18 automatically.

    Also emits a baseline healthy-state prediction every 15min so L29 Brier score
    updates during normal operation (not only when the system is under stress).
    """
    # L29 baseline: when coherence is stable and good, predict it stays good.
    # This ensures Brier score has signal to track during healthy sessions.
    if _shared._last_correlations and _shared._last_correlations.get("status") == "active":
        coherence = _shared._last_correlations.get("coherence_avg", 0.0)
        if coherence >= 0.7 and not any(
            p["type"] == "coherence_stable" and p["outcome"] is None for p in _shared._predictions
        ):
            record_prediction(
                "coherence_stable",
                "coherence drops below 0.6 within 15 minutes",
                window_s=900,
                confidence=0.1,  # healthy system — bad outcome is unlikely; low prob → low Brier on expiry
            )

    if not _shared._last_correlations or not _shared._last_correlations.get("alerts"):
        return
    for alert in _shared._last_correlations["alerts"]:
        atype = alert.get("type", "")
        # Resolve active coherence_stable baseline when coherence actually declines
        if atype == "coherence_declining":
            for p in _shared._predictions:
                if p["type"] == "coherence_stable" and p["outcome"] is None:
                    resolve_prediction(p["id"], outcome_occurred=True)
        # Don't duplicate — stored prediction type equals atype (consistent naming)
        if any(p["type"] == atype and p["outcome"] is None for p in _shared._predictions):
            continue
        if atype == "shim_decay_precursor":
            record_prediction(
                "shim_decay_precursor",
                "shim crash within 10 minutes",
                intervention="preemptive alert surfaced to narrator",
                window_s=600,
            )
        elif atype == "coherence_declining":
            record_prediction(
                "coherence_declining",
                "coherence drops below 0.3 within 15 minutes",
                window_s=900,
            )
        elif atype == "shim_latency_spike":
            record_prediction(
                "shim_latency_spike",
                "shim becomes unreachable within 5 minutes",
                intervention="latency alert surfaced",
                window_s=300,
            )


# Layer 22: Causal Attribution Graph
