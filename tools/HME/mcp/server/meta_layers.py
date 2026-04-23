"""Meta-observer layer implementations (L13-L∞∞).

Extracted from meta_observer.py. Each layer is a self-contained function
called by the meta_loop dispatcher at configured intervals.
"""
import os
import sys
import json
import shutil
import subprocess
import time
import logging
import threading
import re

# Ensure tools/HME/mcp/ is on sys.path so `from hme_env import ENV` works
# regardless of import order (meta_layers can be loaded before meta_observer
# when the module graph is warm-primed on a fresh interpreter).
_mcp_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)

from hme_env import ENV  # noqa: E402

logger = logging.getLogger("HME.meta")

# Shared state — imported from meta_observer at call time to avoid circular imports.
# All functions that need _ms access it via meta_observer._ms.
_HEARTBEAT_INTERVAL = 30
_MONITOR_CHECK_INTERVAL = 45
_CORRELATION_WINDOW = 3600
_NARRATION_INTERVAL = 300
_MAX_NARRATIVE_LINES = 500
_ENV_CHECK_INTERVAL = 180
_ENTANGLE_INTERVAL = 120
_COUNTERFACTUAL_FILE_SUFFIX = "hme-counterfactuals.jsonl"

# MetaState instance — set by meta_observer.start() before the loop begins.
_ms = None  # type: ignore

# Layer 13: Self-Observing Monitor

_monitor_thread_ref: threading.Thread | None = None
_monitor_restart_count = 0


def register_monitor_thread(thread: threading.Thread) -> None:
    global _monitor_thread_ref
    _monitor_thread_ref = thread


def _check_monitor_alive() -> dict:
    status = {"checked": True, "ts": time.time()}
    if _monitor_thread_ref is None:
        status["state"] = "unregistered"
        return status
    if _monitor_thread_ref.is_alive():
        status["state"] = "alive"
    else:
        global _monitor_restart_count
        _monitor_restart_count += 1
        status["state"] = "dead"
        status["restart_attempt"] = _monitor_restart_count
        logger.warning(
            f"Meta-observer L13: monitor thread DEAD (restart #{_monitor_restart_count})"
        )
    return status


def _write_heartbeat() -> None:
    try:
        with open(_ms.heartbeat_file, "w") as f:
            json.dump({"ts": time.time(), "pid": os.getpid()}, f)
    except OSError:  # silent-ok: heartbeat write is advisory; a missed beat is tolerated by readers
        pass


def _read_heartbeat() -> dict | None:
    try:
        with open(_ms.heartbeat_file) as f:
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


# Layer 14: Temporal Correlator

_last_correlations: dict = {}
_SYNTHESIS_WINDOW = 3600  # 1 hour of synthesis records for pattern detection


def _load_synthesis_history() -> list[dict]:
    """Load recent synthesis call records from hme-synthesis.jsonl (L19/L20)."""
    if not _ms.synthesis_file:
        return []
    try:
        entries = []
        cutoff = time.time() - _SYNTHESIS_WINDOW
        with open(_ms.synthesis_file) as f:
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
        with open(_ms.coherence_file) as f:
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
        with open(_ms.ops_file) as f:
            ops = json.load(f)
    except (OSError, json.JSONDecodeError):  # silent-ok: ops file absent or empty on first read; downstream handles empty dict
        pass

    from server import meta_correlator
    return meta_correlator.correlate(history, ops, _CORRELATION_WINDOW)


# Layer 15: Prescriptive Narrator

def _narrate(monitor_status: dict, correlations: dict) -> str:
    intent = _current_intent  # snap to avoid TOCTOU between guard and access
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
    if _last_env_snapshot:
        env_alerts = _last_env_snapshot.get("alerts", [])
        if env_alerts:
            for ea in env_alerts[:2]:
                parts.append(f"ENV: {ea['message']}")
        else:
            disk = _last_env_snapshot.get("disk_free_gb")
            rss = _last_env_snapshot.get("process_rss_mb")
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
    elif any(a.get("type") == "gpu_memory_pressure" for a in _last_env_snapshot.get("alerts", [])):
        parts.append("ACTION: GPU memory critical — consider unloading unused models or reducing batch size.")
    elif any(a.get("type") == "cb_flapping" for a in correlations.get("alerts", [])):
        parts.append("ACTION: Circuit breaker flapping — model is oscillating between available/unavailable. Check GPU OOM pressure or thermal throttling.")
    elif any(a.get("type") == "synthesis_phantom_surge" for a in correlations.get("alerts", [])):
        parts.append("ACTION: High phantom rate in synthesis outputs — consider running hme_admin(action='index') to refresh module index.")

    return " ".join(parts)


def _write_narrative(narrative: str) -> None:
    try:
        entry = json.dumps({"ts": time.time(), "narrative": narrative})
        with open(_ms.narrative_file, "a") as f:
            f.write(entry + "\n")
        _trim_narrative_file()
    except OSError as e:
        logger.warning(f"Meta-observer L15: narrative write failed: {e}")


def _trim_narrative_file() -> None:
    try:
        with open(_ms.narrative_file) as f:
            lines = f.readlines()
        if len(lines) > _MAX_NARRATIVE_LINES:
            with open(_ms.narrative_file, "w") as f:
                f.writelines(lines[-_MAX_NARRATIVE_LINES:])
    except OSError:  # silent-ok: narrative-file trim; failure defers compaction one cycle
        pass


def _read_last_narrative() -> dict | None:
    if _ms is None or not _ms.narrative_file:
        return None
    try:
        with open(_ms.narrative_file) as f:
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

_last_env_snapshot: dict = {}


def _scan_environment() -> dict:
    env = {"ts": time.time()}

    # Disk space for project root
    try:
        usage = shutil.disk_usage(ENV.optional("PROJECT_ROOT", "/"))
        env["disk_free_gb"] = round(usage.free / (1024 ** 3), 1)
        env["disk_pct_used"] = round((usage.used / usage.total) * 100, 1)
    except OSError:  # silent-ok: disk-usage probe is advisory telemetry; absence on exotic filesystems is acceptable
        pass

    # System load average (1, 5, 15 min)
    try:
        load = os.getloadavg()
        env["load_1m"] = round(load[0], 2)
        env["load_5m"] = round(load[1], 2)
        env["load_15m"] = round(load[2], 2)
    except OSError:  # silent-ok: loadavg probe is Linux-specific; non-Linux hosts intentionally skip
        pass

    # GPU memory (nvidia-smi, non-blocking)
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=index,memory.used,memory.total,memory.free",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
        )
        if result.returncode == 0:
            gpus = []
            for line in result.stdout.strip().split("\n"):
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 4:
                    try:
                        used, total, free = int(parts[1]), int(parts[2]), int(parts[3])
                        gpus.append({
                            "index": int(parts[0]),
                            "used_mb": used,
                            "total_mb": total,
                            "free_mb": free,
                            "pct_used": round((used / max(total, 1)) * 100, 1),
                        })
                    except (ValueError, IndexError):
                        continue  # skip lines with N/A or malformed values
            env["gpus"] = gpus
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):  # silent-ok: nvidia-smi probe; non-NVIDIA hosts or missing binary intentionally skip
        pass

    # Process RSS (own memory footprint)
    try:
        with open(f"/proc/{os.getpid()}/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    env["process_rss_mb"] = round(int(line.split()[1]) / 1024, 1)
                    break
    except OSError:  # silent-ok: /proc/self/status probe is Linux-specific; non-Linux hosts skip
        pass

    # Generate alerts
    alerts = []
    if env.get("disk_pct_used", 0) > 90:
        alerts.append({"type": "disk_pressure", "message": f"Disk {env['disk_pct_used']}% full — index operations may fail"})
    for gpu in env.get("gpus", []):
        if gpu["free_mb"] < 500:
            alerts.append({"type": "gpu_memory_pressure", "message": f"GPU{gpu['index']} only {gpu['free_mb']}MB free — OOM imminent on next model load"})
    if env.get("load_1m", 0) > os.cpu_count() * 2:
        alerts.append({"type": "cpu_overload", "message": f"Load {env['load_1m']} exceeds 2x CPU count — system thrashing"})
    if env.get("process_rss_mb", 0) > 8192:
        alerts.append({"type": "memory_bloat", "message": f"MCP process at {env['process_rss_mb']}MB RSS — possible memory leak"})
    env["alerts"] = alerts
    return env


# Layer 17: Conversation Entanglement

def _checkpoint_entanglement() -> None:
    """Checkpoint conversation-relevant state so the system's self-model survives compaction."""
    try:
        state = {
            "ts": time.time(),
            "pid": os.getpid(),
        }

        # What the correlator knows
        if _last_correlations:
            state["coherence_avg"] = _last_correlations.get("coherence_avg")
            state["coherence_trend"] = _last_correlations.get("coherence_trend")
            state["active_alerts"] = [a["type"] for a in _last_correlations.get("alerts", [])]
            state["dip_count"] = _last_correlations.get("dip_count", 0)

        # What the environment shows
        if _last_env_snapshot:
            state["disk_pct"] = _last_env_snapshot.get("disk_pct_used")
            state["gpu_pressure"] = any(
                g.get("free_mb", 9999) < 1000
                for g in _last_env_snapshot.get("gpus", [])
            )
            state["process_rss_mb"] = _last_env_snapshot.get("process_rss_mb")

        # Operational state cross-reference + L19/L21
        try:
            with open(_ms.ops_file) as f:
                ops = json.load(f)
            state["restarts_today"] = ops.get("restarts_today", 0)
            state["recovery_rate"] = ops.get("recovery_success_rate_ema")
            state["session_age_s"] = round(time.time() - (ops.get("session_start") or time.time()))
            # L19: synthesis routing profile for compaction context
            synth_calls = ops.get("synthesis_calls_today", 0)
            if synth_calls > 0:
                state["synthesis_calls"] = synth_calls
                state["synthesis_phantom_rate"] = ops.get("synthesis_phantom_rate_ema")
                state["synthesis_cascade_rate"] = ops.get("synthesis_cascade_rate_ema")
            # L21: CB flap summary
            flap_total = ops.get("circuit_breaker_flaps_total_today", 0)
            if flap_total > 0:
                state["cb_flaps_today"] = flap_total
            # L23: multi-timescale coherence for compaction
            ms_beat = ops.get("coherence_beat_ema")
            ms_phrase = ops.get("coherence_phrase_ema")
            ms_section = ops.get("coherence_section_ema")
            ms_structure = ops.get("coherence_structure_ema")
            if ms_phrase is not None:
                state["coherence_multiscale"] = {
                    "beat": ms_beat, "phrase": ms_phrase,
                    "section": ms_section, "structure": ms_structure,
                }
            # L29: prediction calibration
            brier = ops.get("brier_score_ema")
            if brier is not None:
                state["brier_score"] = brier
            # L34: thermodynamic efficiency
            thermo_eff = ops.get("thermo_efficiency_ema")
            if thermo_eff is not None:
                state["thermo_efficiency"] = thermo_eff
                state["thermo_entropy"] = ops.get("thermo_entropy_ema")
        except (OSError, json.JSONDecodeError) as _ops_err:
            # ops-file read failure means L28/L29/L34 signals (prediction
            # calibration, thermo efficiency, Brier score) drop from the
            # state snapshot. Surface via LIFESAVER so the agent sees
            # "observability partial" banner and knows why the reports went blank.
            logger.error(f"ops file read FAILED: {type(_ops_err).__name__}: {_ops_err}")
            try:
                from server import context as _ctx
                _ctx.register_critical_failure(
                    "meta_layers.ops_file",
                    f"operational_state unreadable ({type(_ops_err).__name__}); L28/29/34 signals missing from state snapshot",
                    severity="CRITICAL",
                )
            except Exception as _life_err:
                logger.debug(f"LIFESAVER register failed: {_life_err}")

        # Last narrative (the system's own interpretation)
        last_narr = _read_last_narrative()
        if last_narr:
            state["last_narrative"] = last_narr.get("narrative", "")[:300]

        # Counterfactual effectiveness
        eff = _compute_effectiveness()
        if eff.get("total_predictions", 0) > 0:
            state["intervention_accuracy"] = eff.get("accuracy")

        # Recent transcript topics (what files/modules were discussed)
        try:
            import re as _re
            transcript_path = os.path.join(
                ENV.optional("PROJECT_ROOT", ""),
                "log", "session-transcript.jsonl"
            )
            if os.path.exists(transcript_path):
                recent_files = set()
                with open(transcript_path) as f:
                    lines = f.readlines()
                for line in lines[-20:]:
                    try:
                        entry = json.loads(line.strip())
                        text = json.dumps(entry)
                        paths = _re.findall(r'(?:src|tools)/[\w/]+\.(?:js|py|ts)', text)
                        recent_files.update(paths[:5])
                    except (json.JSONDecodeError, ValueError):
                        continue
                if recent_files:
                    state["recent_files"] = sorted(recent_files)[:10]
        except OSError:  # silent-ok: recent-files probe; directory absence or permission issue leaves state without that field
            pass

        # Write atomically
        tmp = _ms.entanglement_file + ".tmp"
        with open(tmp, "w") as f:
            json.dump(state, f, indent=2)
        os.replace(tmp, _ms.entanglement_file)
    except Exception as e:
        logger.warning(f"Meta-observer L17: entanglement checkpoint failed: {e}")


def _read_entanglement() -> dict | None:
    try:
        with open(_ms.entanglement_file) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def read_entanglement_for_compaction() -> str | None:
    """Produce a compact summary for injection into compaction context.

    Called by the PreCompact hook so the system's self-model survives
    context window compression.
    """
    state = _read_entanglement()
    if state is None:
        return None
    age = time.time() - state.get("ts", 0)
    if age > 600:  # older than 10 minutes
        return None
    parts = []
    if state.get("coherence_avg") is not None:
        parts.append(f"coherence={state['coherence_avg']:.0%}")
    if state.get("coherence_trend") is not None:
        t = state["coherence_trend"]
        parts.append(f"trend={'up' if t > 0.02 else 'down' if t < -0.02 else 'stable'}")
    if state.get("restarts_today"):
        parts.append(f"restarts={state['restarts_today']}")
    if state.get("session_age_s"):
        parts.append(f"session={state['session_age_s'] // 60}min")
    if state.get("gpu_pressure"):
        parts.append("GPU_PRESSURE")
    if state.get("active_alerts"):
        parts.append(f"alerts={','.join(state['active_alerts'][:3])}")
    if state.get("recent_files"):
        parts.append(f"files={','.join(os.path.basename(f) for f in state['recent_files'][:5])}")
    if state.get("intervention_accuracy") is not None:
        parts.append(f"intervention_accuracy={state['intervention_accuracy']:.0%}")
    if state.get("synthesis_calls", 0) > 0:
        parts.append(f"synth={state['synthesis_calls']}calls")
        if state.get("synthesis_phantom_rate") is not None:
            parts.append(f"phantom={state['synthesis_phantom_rate']:.0%}")
    if state.get("cb_flaps_today", 0) > 0:
        parts.append(f"cb_flaps={state['cb_flaps_today']}")
    # L23: multi-timescale coherence
    ms = state.get("coherence_multiscale")
    if ms and ms.get("phrase") is not None:
        parts.append(f"coherence_ms=b{ms['beat']:.2f}/p{ms['phrase']:.2f}/s{ms.get('section', 0):.2f}")
    # L29: prediction accuracy
    if state.get("brier_score") is not None:
        parts.append(f"brier={state['brier_score']:.3f}")
    # L34: thermodynamic efficiency
    if state.get("thermo_efficiency") is not None:
        parts.append(f"thermo_eff={state['thermo_efficiency']:.3f}")
    return "[HME state] " + " | ".join(parts) if parts else None


# Layer 18: Counterfactual Reasoning

_predictions: list[dict] = []  # active predictions awaiting outcome


def record_prediction(prediction_type: str, predicted_outcome: str,
                      intervention: str | None = None, window_s: float = 600,
                      confidence: float | None = None) -> str:
    """Record a prediction about what will happen. Returns prediction ID.

    confidence: explicit probability that predicted_outcome occurs (0-1).
    If None, defaults to 0.8 (no intervention) or 0.6 (with intervention) for L29 Brier.
    Use low confidence (e.g. 0.1) for baseline/healthy-state predictions of bad outcomes.
    """
    pred_id = f"pred-{int(time.time())}-{len(_predictions)}"
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
    _predictions.append(pred)
    logger.info(f"Meta-observer L18: prediction {pred_id} — {prediction_type}: "
                f"expecting '{predicted_outcome}' within {window_s}s"
                f"{f', intervening with: {intervention}' if intervention else ''}")
    return pred_id


def resolve_prediction(pred_id: str, outcome_occurred: bool) -> None:
    """Mark a prediction as resolved — did the predicted outcome happen?"""
    for pred in _predictions:
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
    for pred in _predictions:
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
    _predictions[:] = [p for p in _predictions if
                       p["outcome"] is None or
                       time.time() - p["outcome"].get("resolved_ts", 0) < 3600]


def _write_counterfactual(pred: dict) -> None:
    try:
        with open(_ms.counterfactual_file, "a") as f:
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
        with open(_ms.counterfactual_file) as f:
            lines = f.readlines()
        if len(lines) > max_lines:
            with open(_ms.counterfactual_file, "w") as f:
                f.writelines(lines[-max_lines:])
    except OSError:  # silent-ok: counterfactual-file trim; failure defers compaction one cycle
        pass


def _compute_effectiveness() -> dict:
    """Compute intervention effectiveness from counterfactual history."""
    try:
        if not os.path.exists(_ms.counterfactual_file):
            return {"total_predictions": 0}
        resolved = []
        with open(_ms.counterfactual_file) as f:
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
    if not _ms.synthesis_file or not _ms.synthesis_patterns_file:
        return
    try:
        entries = []
        with open(_ms.synthesis_file) as f:
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
        tmp = _ms.synthesis_patterns_file + ".tmp"
        with open(tmp, "w") as f:
            json.dump(patterns, f, indent=2)
        os.replace(tmp, _ms.synthesis_patterns_file)
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
    if _last_correlations and _last_correlations.get("status") == "active":
        coherence = _last_correlations.get("coherence_avg", 0.0)
        if coherence >= 0.7 and not any(
            p["type"] == "coherence_stable" and p["outcome"] is None for p in _predictions
        ):
            record_prediction(
                "coherence_stable",
                "coherence drops below 0.6 within 15 minutes",
                window_s=900,
                confidence=0.1,  # healthy system — bad outcome is unlikely; low prob → low Brier on expiry
            )

    if not _last_correlations or not _last_correlations.get("alerts"):
        return
    for alert in _last_correlations["alerts"]:
        atype = alert.get("type", "")
        # Resolve active coherence_stable baseline when coherence actually declines
        if atype == "coherence_declining":
            for p in _predictions:
                if p["type"] == "coherence_stable" and p["outcome"] is None:
                    resolve_prediction(p["id"], outcome_occurred=True)
        # Don't duplicate — stored prediction type equals atype (consistent naming)
        if any(p["type"] == atype and p["outcome"] is None for p in _predictions):
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

def _causal_attribution() -> dict | None:
    """Attribute phantom rate to its structural causes via simple linear decomposition.

    Factors: cascade_rate, prompt_complexity (avg word count), cb_flaps, escalation_rate.
    Each factor's contribution = correlation with phantom_rate across recent synthesis records.
    Returns attribution dict or None if insufficient data.
    """
    if not _ms.synthesis_file:
        return None
    try:
        entries = []
        with open(_ms.synthesis_file) as f:
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
    if not _last_correlations or _last_correlations.get("status") != "active":
        return None
    avg = _last_correlations.get("coherence_avg", 0.7)
    trend = _last_correlations.get("coherence_trend", 0.0)
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

_run_history_dir = ""

def _load_run_history() -> list[dict]:
    """Load run history from metrics/run-history/ directory (individual JSON files per run)."""
    global _run_history_dir
    if not _run_history_dir:
        root = ENV.optional("PROJECT_ROOT", "")
        if not root:
            return []
        _run_history_dir = os.path.join(root, "output", "metrics", "run-history")
    try:
        filenames = sorted(os.listdir(_run_history_dir))
    except OSError:
        return []
    runs = []
    for fn in filenames[-50:]:
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(_run_history_dir, fn)) as f:
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

_current_intent: dict = {}
_INTENT_SIGNALS = {
    "debugging": {"error", "bug", "crash", "fix", "broken", "fail", "traceback",
                  "stack", "exception", "not working", "why is"},
    "design": {"architecture", "design", "should we", "approach", "boundary",
               "coupling", "how should", "what if", "propose", "strategy"},
    "implementation": {"implement", "add", "create", "write", "extend", "wire",
                       "modify", "change", "update", "refactor"},
    "stress_testing": {"evolve", "stress", "contradict", "invariant", "probe",
                       "enforcement", "validate", "verify", "test"},
    "lab": {"sketch", "postboot", "lab", "verdict", "experiment", "trial",
            "prototype", "monkey-patch"},
}


def _classify_intent() -> dict:
    """Classify current conversation mode from recent transcript entries.

    Five modes: debugging, design, implementation, stress_testing, lab.
    Returns {mode, confidence, hints} based on keyword density in last 20 transcript entries.
    """
    global _current_intent
    try:
        transcript_path = os.path.join(
            ENV.optional("PROJECT_ROOT", ""),
            "log", "session-transcript.jsonl"
        )
        if not os.path.exists(transcript_path):
            return _current_intent

        recent_text = ""
        with open(transcript_path) as f:
            lines = f.readlines()
        for line in lines[-20:]:
            try:
                entry = json.loads(line.strip())
                recent_text += " " + json.dumps(entry).lower()
            except (json.JSONDecodeError, ValueError):
                continue

        if not recent_text:
            return _current_intent

        scores: dict[str, int] = {}
        hints: dict[str, list[str]] = {}
        for mode, signals in _INTENT_SIGNALS.items():
            hits = []
            for s in signals:
                if s in recent_text:
                    hits.append(s)
            scores[mode] = len(hits)
            hints[mode] = hits

        if not any(scores.values()):
            _current_intent = {"mode": None, "confidence": 0.0}
            return _current_intent

        best_mode = max(scores, key=scores.get)
        total_signals = sum(scores.values())
        confidence = scores[best_mode] / max(total_signals, 1)

        _current_intent = {
            "mode": best_mode if confidence > 0.3 else None,
            "confidence": round(confidence, 2),
            "scores": scores,
            "hints": hints.get(best_mode, []),
        }
        return _current_intent
    except Exception as _err:
        logger.debug(f"unnamed-except meta_observer.py:1274: {type(_err).__name__}: {_err}")
        return _current_intent


def get_current_intent() -> dict:
    """Public accessor for L26 morphogenetic pre-loading in synthesis_llamacpp."""
    return _current_intent


# Layer 33: Cross-Session Archaeology

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
        if os.path.exists(_ms.synthesis_patterns_file):
            with open(_ms.synthesis_patterns_file) as f:
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


# Main Loop

_last_narration_ts: float = 0.0
_last_env_ts: float = 0.0
_last_entangle_ts: float = 0.0
_last_synthesis_pattern_ts: float = 0.0
_last_intent_ts: float = 0.0
_last_archaeology_ts: float = 0.0
_last_kb_confidence_ts: float = 0.0
_SYNTHESIS_PATTERN_INTERVAL = 1800  # 30 minutes
_INTENT_INTERVAL = 120              # 2 minutes
_ARCHAEOLOGY_INTERVAL = 21600       # 6 hours
