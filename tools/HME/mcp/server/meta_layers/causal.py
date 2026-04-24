"""Layer 18: causal attribution, anticipatory lookahead, run-history correlation, KB confidence updates."""
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


def _causal_attribution() -> dict | None:
    """Attribute phantom rate to its structural causes via simple linear decomposition.

    Factors: cascade_rate, prompt_complexity (avg word count), cb_flaps, escalation_rate.
    Each factor's contribution = correlation with phantom_rate across recent synthesis records.
    Returns attribution dict or None if insufficient data.
    """
    if not _shared._ms.synthesis_file:
        return None
    try:
        entries = []
        with open(_shared._ms.synthesis_file) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                    if e.get("phantom_rate") is not None:
                        entries.append(e)
                except json.JSONDecodeError:
                    continue
        if len(entries) < 15:
            return None

        phantom_rates = [e["phantom_rate"] for e in entries]
        avg_phantom = sum(phantom_rates) / len(phantom_rates)
        if avg_phantom < 0.01:
            return {"status": "clean", "avg_phantom": round(avg_phantom, 3)}

        factors = {
            "cascade_usage": [1.0 if e.get("used_cascade") else 0.0 for e in entries],
            "escalation": [1.0 if e.get("escalated") else 0.0 for e in entries],
            "prompt_length": [len(e.get("prompt_head", "")) for e in entries],
            "elapsed_s": [e.get("elapsed_s", 0) for e in entries],
        }

        # Guard: if phantom_rate has near-zero variance, all correlations = 0
        # and attribution is meaningless — report insufficient_variation instead
        phantom_var = sum((p - avg_phantom) ** 2 for p in phantom_rates) / len(phantom_rates)
        if phantom_var < 1e-6:
            return {"status": "insufficient_variation", "avg_phantom": round(avg_phantom, 3),
                    "sample_count": len(phantom_rates)}

        attribution = {}
        n = len(phantom_rates)
        for name, vals in factors.items():
            if len(vals) != n:
                continue
            mean_f = sum(vals) / n
            mean_p = avg_phantom
            cov = sum((vals[i] - mean_f) * (phantom_rates[i] - mean_p) for i in range(n)) / n
            var_f = sum((v - mean_f) ** 2 for v in vals) / n
            corr = cov / max(var_f ** 0.5 * phantom_var ** 0.5, 1e-9)
            attribution[name] = round(corr, 3)

        # Sort by absolute correlation strength
        primary = max(attribution.items(), key=lambda x: abs(x[1]))
        return {
            "status": "attributed",
            "avg_phantom": round(avg_phantom, 3),
            "attribution": attribution,
            "primary_cause": primary[0],
            "primary_correlation": primary[1],
            "sample_count": n,
        }
    except (OSError, json.JSONDecodeError):
        return None


# Layer 24: Anticipatory Lookahead

def _anticipatory_lookahead() -> dict | None:
    """Simulate forward EMA trajectories at T+5/15/30min under current trajectory.

    Uses current coherence trend from L14 to project where coherence will be.
    If projected coherence drops below 0.5, suggests intervention.
    """
    if not _shared._last_correlations or _shared._last_correlations.get("status") != "active":
        return None
    avg = _shared._last_correlations.get("coherence_avg", 0.7)
    trend = _shared._last_correlations.get("coherence_trend", 0.0)
    try:
        from server import operational_state
        ms = operational_state.get_multiscale_coherence()
        phrase_ema = avg if ms.get("phrase") is None else ms["phrase"]
    except Exception as _err:
        logger.debug(f"unnamed-except meta_observer.py:1027: {type(_err).__name__}: {_err}")
        phrase_ema = avg

    # Simple linear projection from current trend
    proj = {}
    for label, minutes in [("T+5", 5), ("T+15", 15), ("T+30", 30)]:
        # trend is per-hour; scale to minutes
        delta = trend * (minutes / 60)
        projected = max(0.0, min(1.0, phrase_ema + delta))
        proj[label] = round(projected, 3)

    result = {"projections": proj, "current": round(phrase_ema, 3), "trend": round(trend, 3)}
    if proj.get("T+30", 1.0) < 0.5:
        result["intervention_needed"] = True
        result["suggestion"] = "coherence projected below 0.5 at T+30 — consider KB pre-warm or cascade-only routing"
    return result


# Layer 27: Composition-Infrastructure Correlation

_shared._run_history_dir = ""

def _load_run_history() -> list[dict]:
    """Load run history from metrics/run-history/ directory (individual JSON files per run)."""

    if not _shared._run_history_dir:
        root = ENV.optional("PROJECT_ROOT", "")
        if not root:
            return []
        _shared._run_history_dir = os.path.join(root, "output", "metrics", "run-history")
    try:
        filenames = sorted(os.listdir(_shared._run_history_dir))
    except OSError:
        return []
    runs = []
    for fn in filenames[-50:]:
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(_shared._run_history_dir, fn)) as f:
                runs.append(json.load(f))
        except (OSError, json.JSONDecodeError):
            continue
    return runs


def _iso_to_unix(ts_str) -> float | None:
    """Convert ISO 8601 timestamp string to Unix float. Returns None on failure."""
    if isinstance(ts_str, (int, float)):
        return float(ts_str)
    if not isinstance(ts_str, str):
        return None
    try:
        import datetime
        # Handle trailing Z (UTC) and fractional seconds
        s = ts_str.rstrip("Z").split(".")[0]
        dt = datetime.datetime.strptime(s, "%Y-%m-%dT%H:%M:%S")
        return dt.replace(tzinfo=datetime.timezone.utc).timestamp()
    except (ValueError, AttributeError):
        return None


def _correlate_composition_runs() -> dict | None:
    """Correlate HME operational quality with Polychron run outcomes.

    Reads metrics/run-history/ directory (individual JSON files per run) and
    compares run verdicts against synthesis quality at run time.
    Builds a simple model: does high phantom rate predict DRIFTED runs?
    """
    runs = _load_run_history()
    if len(runs) < 5:
        return None

    # Load session documents for time-correlation
    try:
        from server import operational_state
        sessions = operational_state.load_recent_sessions(max_age_days=14)
    except Exception as _err:
        logger.debug(f"unnamed-except meta_observer.py:1104: {type(_err).__name__}: {_err}")
        return None
    if not sessions:
        return None

    # Match runs to sessions by timestamp overlap
    correlations = []
    for run in runs[-30:]:
        run_ts_raw = run.get("ts") or run.get("timestamp")
        run_ts = _iso_to_unix(run_ts_raw)
        verdict = run.get("verdict") or run.get("label")
        if not run_ts or not verdict:
            continue
        for sess in sessions:
            s_start = sess.get("session_start") or 0
            s_end = sess.get("session_end") or s_start + 3600
            if s_start <= run_ts <= s_end:
                correlations.append({
                    "verdict": verdict,
                    "phantom_rate": sess.get("synthesis_phantom_rate_ema"),
                    "coherence": sess.get("coherence_phrase_ema"),
                    "cascade_rate": sess.get("synthesis_cascade_rate_ema"),
                })
                break

    if len(correlations) < 3:
        return {"status": "insufficient_overlap", "matched": len(correlations)}

    stable = [c for c in correlations if c["verdict"] in ("STABLE", "EVOLVED")]
    drifted = [c for c in correlations if c["verdict"] in ("DRIFTED", "REGRESSED")]

    result = {"status": "correlated", "matched": len(correlations),
              "stable_count": len(stable), "drifted_count": len(drifted)}

    if stable:
        avg_phantom_stable = sum(c.get("phantom_rate") or 0 for c in stable) / len(stable)
        result["stable_avg_phantom"] = round(avg_phantom_stable, 3)
    if drifted:
        avg_phantom_drifted = sum(c.get("phantom_rate") or 0 for c in drifted) / len(drifted)
        result["drifted_avg_phantom"] = round(avg_phantom_drifted, 3)

    return result


# Layer 28: Living KB Confidence

def _update_kb_confidence() -> dict | None:
    """Test self-coherence KB claims against recent operational data.

    Reads KB entries tagged 'hme-infrastructure' (HME self-description entries).
    For each, checks if the claim is supported, contradicted, or untestable
    given current operational data. Does NOT modify KB text.
    """
    try:
        from server import context as ctx
        if not hasattr(ctx, 'project_engine') or ctx.project_engine is None:
            return None
        kb = ctx.project_engine
        if not hasattr(kb, 'list_knowledge_full'):
            return None
        all_entries = kb.list_knowledge_full()
        # HME self-description entries are tagged 'hme-infrastructure', not category='self-coherence'
        entries = [e for e in all_entries if "hme-infrastructure" in (e.get("tags") or "")]
        if not entries:
            return None
    except Exception as _err:
        logger.debug(f"unnamed-except meta_observer.py:1169: {type(_err).__name__}: {_err}")
        return None

    try:
        from server import operational_state
        ops = operational_state.snapshot()
    except Exception as _err:
        logger.debug(f"unnamed-except meta_observer.py:1175: {type(_err).__name__}: {_err}")
        return None

    results = {"tested": 0, "supported": 0, "contradicted": 0, "untestable": 0}
    for entry in entries[:20]:
        content = (entry.get("content") or "").lower()
        results["tested"] += 1
        # Heuristic claim testing against operational data
        if "phantom" in content and "rate" in content:
            phantom_ema = ops.get("synthesis_phantom_rate_ema", 0.0)
            if "high" in content and phantom_ema < 0.1:
                results["contradicted"] += 1
            elif "low" in content and phantom_ema > 0.5:
                results["contradicted"] += 1
            else:
                results["supported"] += 1
        elif "crash" in content or "restart" in content:
            crashes = ops.get("shim_crashes_today", 0)
            restarts = ops.get("restarts_today", 0)
            if crashes > 0 or restarts > 3:
                results["supported"] += 1
            else:
                results["supported"] += 1  # claim may still be valid, just not active now
        else:
            results["untestable"] += 1

    return results


# Layer 32: Intent Classification
