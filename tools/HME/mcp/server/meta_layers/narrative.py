"""Layer 14: correlation + narration — synthesis/coherence history, correlate, narrate."""
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


# Layer 14: Temporal Correlator

_shared._last_correlations: dict = {}
_SYNTHESIS_WINDOW = 3600  # 1 hour of synthesis records for pattern detection


def _load_synthesis_history() -> list[dict]:
    """Load recent synthesis call records from hme-synthesis.jsonl (L19/L20)."""
    if not _shared._ms.synthesis_file:
        return []
    try:
        entries = []
        cutoff = time.time() - _SYNTHESIS_WINDOW
        with open(_shared._ms.synthesis_file) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if entry.get("ts", 0) >= cutoff:
                        entries.append(entry)
                except json.JSONDecodeError:
                    continue
        return entries
    except OSError:
        return []


def _load_coherence_history() -> list[dict]:
    try:
        entries = []
        cutoff = time.time() - _CORRELATION_WINDOW
        with open(_shared._ms.coherence_file) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if entry.get("ts", 0) >= cutoff:
                        entries.append(entry)
                except json.JSONDecodeError:
                    continue
        return entries
    except OSError:
        return []


def _correlate(history: list[dict]) -> dict:
    # L23: update multi-timescale coherence EMAs with latest value
    if history:
        coherence_values = [e.get("coherence", 0.0) for e in history]
        try:
            from server import operational_state
            operational_state.record_coherence_multiscale(coherence_values[-1])
        except Exception as _err1:
            logger.debug(f"operational_state.record_coherence_multi: {type(_err1).__name__}: {_err1}")

    # Load ops state for cross-reference, then delegate pure logic to meta_correlator
    ops: dict = {}
    try:
        with open(_shared._ms.ops_file) as f:
            ops = json.load(f)
    except (OSError, json.JSONDecodeError):  # silent-ok: ops file absent or empty on first read; downstream handles empty dict
        pass

    from server import meta_correlator
    return meta_correlator.correlate(history, ops, _CORRELATION_WINDOW)


# Layer 15: Prescriptive Narrator

def _narrate(monitor_status: dict, correlations: dict) -> str:
    intent = _shared._current_intent  # snap to avoid TOCTOU between guard and access
    parts = []

    # System state summary
    monitor_state = monitor_status.get("state", "unknown")
    if monitor_state == "alive":
        parts.append("Health monitor is alive and watching.")
    elif monitor_state == "dead":
        parts.append(f"Health monitor was DEAD — restarted (attempt #{monitor_status.get('restart_attempt', '?')}).")
    elif monitor_state == "unregistered":
        parts.append("Health monitor not yet registered — early startup or proxy not initialized.")

    # Correlation insights
    if correlations.get("status") == "active":
        avg = correlations.get("coherence_avg", 0)
        trend = correlations.get("coherence_trend", 0)
        parts.append(f"Coherence averaging {avg:.0%} with {'improving' if trend > 0.02 else 'declining' if trend < -0.02 else 'stable'} trend.")

        alerts = correlations.get("alerts", [])
        if alerts:
            for alert in alerts[:3]:
                parts.append(f"ALERT: {alert['message']}")
        else:
            parts.append("No anomalies detected — system operating within normal parameters.")

        dips = correlations.get("dip_count", 0)
        if dips > 0:
            parts.append(f"Recommendation: {dips} instability dips detected. "
                         "If recurring, investigate llama.cpp memory pressure or shim resource exhaustion.")
    elif correlations.get("status") == "insufficient_data":
        parts.append(f"Only {correlations.get('samples', 0)} coherence samples — too early for pattern detection.")

    # L16: environmental context
    if _shared._last_env_snapshot:
        env_alerts = _shared._last_env_snapshot.get("alerts", [])
        if env_alerts:
            for ea in env_alerts[:2]:
                parts.append(f"ENV: {ea['message']}")
        else:
            disk = _shared._last_env_snapshot.get("disk_free_gb")
            rss = _shared._last_env_snapshot.get("process_rss_mb")
            if disk is not None and rss is not None:
                parts.append(f"Environment stable ({disk}GB disk free, {rss}MB RSS).")

    # L18: counterfactual insight
    eff = _compute_effectiveness()
    if eff.get("total_interventions", 0) >= 3:
        acc = eff.get("accuracy", 0)
        parts.append(f"Intervention track record: {acc:.0%} accuracy over {eff['total_interventions']} interventions.")

    # L19/L20: synthesis quality insights
    synth_calls = correlations.get("synthesis_calls_today", 0)
    if synth_calls >= 5:
        phantom_ema = correlations.get("synthesis_phantom_rate_ema", 0.0)
        cascade_ema = correlations.get("synthesis_cascade_rate_ema", 0.0)
        parts.append(
            f"Synthesis: {synth_calls} calls today, "
            f"cascade {cascade_ema:.0%}, phantom rate {phantom_ema:.0%}."
        )

    # L23: multi-timescale coherence summary
    try:
        from server import operational_state
        ms = operational_state.get_multiscale_coherence()
        if ms.get("phrase") is not None:
            parts.append(
                f"Multi-scale coherence: beat={ms['beat']:.2f} phrase={ms['phrase']:.2f} "
                f"section={ms.get('section', 0):.2f} structure={ms.get('structure', 0):.2f}."
            )
    except Exception as _err2:
        logger.debug(f"): {type(_err2).__name__}: {_err2}")

    # L29: prediction accuracy
    try:
        from server import operational_state as _ops29
        brier = _ops29.get("brier_score_ema")
        if brier is not None:
            quality = "well-calibrated" if brier < 0.15 else "degraded" if brier > 0.25 else "adequate"
            parts.append(f"Prediction calibration: {quality} (Brier={brier:.3f}).")
    except Exception as _err3:
        logger.debug(f"parts.append: {type(_err3).__name__}: {_err3}")

    # L34: thermodynamic efficiency
    try:
        from server import operational_state as _ops34
        thermo_eff = _ops34.get("thermo_efficiency_ema")
        thermo_ent = _ops34.get("thermo_entropy_ema")
        if thermo_eff is not None:
            parts.append(f"Thermodynamic: efficiency={thermo_eff:.3f}, entropy={thermo_ent:.3f}.")
    except Exception as _err4:
        logger.debug(f"parts.append: {type(_err4).__name__}: {_err4}")

    # L32: intent context
    if intent.get("mode"):
        parts.append(f"Intent: {intent['mode']} (confidence={intent.get('confidence', 0):.0%}).")

    # Prescriptive guidance
    if any(a.get("type") == "shim_decay_precursor" for a in correlations.get("alerts", [])):
        parts.append("ACTION: Preemptively restart shim before the next crash to avoid cascade disruption.")
    elif any(a.get("type") == "restart_churn" for a in correlations.get("alerts", [])):
        parts.append("ACTION: Investigate root cause of restart churn — check OOM, port conflicts, or hanging threads.")
    elif any(a.get("type") == "coherence_declining" for a in correlations.get("alerts", [])):
        parts.append("ACTION: Monitor closely. If decline continues, run status(mode='health') for full diagnostic.")
    elif any(a.get("type") == "gpu_memory_pressure" for a in _shared._last_env_snapshot.get("alerts", [])):
        parts.append("ACTION: GPU memory critical — consider unloading unused models or reducing batch size.")
    elif any(a.get("type") == "cb_flapping" for a in correlations.get("alerts", [])):
        parts.append("ACTION: Circuit breaker flapping — model is oscillating between available/unavailable. Check GPU OOM pressure or thermal throttling.")
    elif any(a.get("type") == "synthesis_phantom_surge" for a in correlations.get("alerts", [])):
        parts.append("ACTION: High phantom rate in synthesis outputs — consider running hme_admin(action='index') to refresh module index.")

    return " ".join(parts)


def _write_narrative(narrative: str) -> None:
    try:
        entry = json.dumps({"ts": time.time(), "narrative": narrative})
        with open(_shared._ms.narrative_file, "a") as f:
            f.write(entry + "\n")
        _trim_narrative_file()
    except OSError as e:
        logger.warning(f"Meta-observer L15: narrative write failed: {e}")


def _trim_narrative_file() -> None:
    try:
        with open(_shared._ms.narrative_file) as f:
            lines = f.readlines()
        if len(lines) > _MAX_NARRATIVE_LINES:
            with open(_shared._ms.narrative_file, "w") as f:
                f.writelines(lines[-_MAX_NARRATIVE_LINES:])
    except OSError:  # silent-ok: narrative-file trim; failure defers compaction one cycle
        pass


def _read_last_narrative() -> dict | None:
    if _shared._ms is None or not _shared._ms.narrative_file:
        return None
    try:
        with open(_shared._ms.narrative_file) as f:
            last = None
            for line in f:
                line = line.strip()
                if line:
                    try:
                        last = json.loads(line)
                    except json.JSONDecodeError:
                        continue
            return last
    except OSError:
        return None


def read_startup_narrative() -> str | None:
    """Read the most recent narrative for bootstrap situational awareness.

    Called during MCP startup so the system remembers not just facts
    but its own interpretation of its state from the previous incarnation.
    """
    last = _read_last_narrative()
    if last is None:
        return None
    age = time.time() - last.get("ts", 0)
    if age > 7200:  # older than 2 hours — too stale
        return None
    return last.get("narrative")


# Layer 16: Environmental Awareness

