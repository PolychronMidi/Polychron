"""HME meta-observer — Layers 13-18 of the self-coherence stack.

Layers 13-15: Recursive self-observation (introspective)
  L13 — Self-Observing Monitor: watches the health monitor thread
  L14 — Temporal Correlator: pattern detection across coherence history
  L15 — Prescriptive Narrator: synthesizes WHY + WHAT TO DO, persists across restarts

Layers 16-18: Extrospective self-coherence (outward-facing)
  L16 — Environmental Awareness: GPU memory, disk space, system load.
        The system adapts to its host, not just its own state.
  L17 — Conversation Entanglement: checkpoints conversation-relevant state
        so the system's self-model survives context compaction.
  L18 — Counterfactual Reasoning: tracks whether interventions actually
        prevented predicted outcomes, building a causal effectiveness model.
"""
import json
import logging
import os
import shutil
import subprocess
import threading
import time

logger = logging.getLogger("HME")

_HEARTBEAT_INTERVAL = 30     # seconds between meta-observer heartbeats
_MONITOR_CHECK_INTERVAL = 45 # seconds between monitor-thread liveness checks
_CORRELATION_WINDOW = 3600   # 1 hour of coherence history for pattern detection
_NARRATION_INTERVAL = 300    # 5 minutes between narrative synthesis cycles
_MAX_NARRATIVE_LINES = 500   # cap narrative JSONL size
_ENV_CHECK_INTERVAL = 180    # 3 minutes between environment scans
_ENTANGLE_INTERVAL = 120     # 2 minutes between conversation checkpoints
_COUNTERFACTUAL_FILE_SUFFIX = "hme-counterfactuals.jsonl"

_active = False
_thread: threading.Thread | None = None
_heartbeat_file = ""
_coherence_file = ""
_narrative_file = ""
_ops_file = ""
_counterfactual_file = ""
_entanglement_file = ""


def start(project_root: str) -> None:
    global _active, _thread, _heartbeat_file, _coherence_file, _narrative_file
    global _ops_file, _counterfactual_file, _entanglement_file
    if _active:
        return
    _heartbeat_file = os.path.join(project_root, "tmp", "hme-meta-observer.heartbeat")
    _coherence_file = os.path.join(project_root, "metrics", "hme-coherence.jsonl")
    _narrative_file = os.path.join(project_root, "metrics", "hme-narrative.jsonl")
    _ops_file = os.path.join(project_root, "tmp", "hme-ops.json")
    _counterfactual_file = os.path.join(project_root, "metrics", _COUNTERFACTUAL_FILE_SUFFIX)
    _entanglement_file = os.path.join(project_root, "tmp", "hme-entanglement.json")
    os.makedirs(os.path.dirname(_heartbeat_file), exist_ok=True)
    os.makedirs(os.path.dirname(_narrative_file), exist_ok=True)

    gap = _detect_observation_gap()
    if gap:
        logger.warning(f"Meta-observer: observation gap detected — {gap}")

    _active = True
    _thread = threading.Thread(target=_meta_loop, daemon=True, name="hme-meta-observer")
    _thread.start()
    logger.info("Meta-observer started (L13 monitor-watch + L14 correlator + L15 narrator)")


def stop() -> None:
    global _active
    _active = False


def get_status() -> dict:
    return {
        "active": _active,
        "thread_alive": _thread.is_alive() if _thread else False,
        "last_heartbeat": _read_heartbeat(),
        "last_narrative": _read_last_narrative(),
        "correlations": _last_correlations.copy(),
        "environment": _last_env_snapshot.copy(),
        "entanglement": _read_entanglement(),
        "counterfactual_effectiveness": _compute_effectiveness(),
    }


# ── Layer 13: Self-Observing Monitor ───────────────────────────────────────

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
            f"Meta-observer L13: monitor thread DEAD (restart #{_monitor_restart_count}) — "
            "the watcher itself needs watching"
        )
        _try_restart_monitor()
    return status


def _try_restart_monitor():
    try:
        from server import rag_proxy
        port = int(os.environ.get("HME_SHIM_PORT", "7734"))
        if hasattr(rag_proxy, '_proxy_monitor_active'):
            rag_proxy._proxy_monitor_active = True
            t = threading.Thread(
                target=rag_proxy._proxy_health_monitor,
                args=(port,),
                daemon=True,
                name="hme-proxy-monitor-revived",
            )
            t.start()
            register_monitor_thread(t)
            logger.info("Meta-observer L13: monitor thread restarted")
    except Exception as e:
        logger.error(f"Meta-observer L13: failed to restart monitor: {e}")


def _write_heartbeat() -> None:
    try:
        with open(_heartbeat_file, "w") as f:
            json.dump({"ts": time.time(), "pid": os.getpid()}, f)
    except OSError:
        pass


def _read_heartbeat() -> dict | None:
    try:
        with open(_heartbeat_file) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _detect_observation_gap() -> str | None:
    hb = _read_heartbeat()
    if hb is None:
        return "no prior heartbeat (first run or file lost)"
    age = time.time() - hb.get("ts", 0)
    old_pid = hb.get("pid", 0)
    if age > _HEARTBEAT_INTERVAL * 3:
        return f"{age:.0f}s since last heartbeat (pid {old_pid}) — meta-observer was down"
    return None


# ── Layer 14: Temporal Correlator ──────────────────────────────────────────

_last_correlations: dict = {}


def _load_coherence_history() -> list[dict]:
    try:
        entries = []
        cutoff = time.time() - _CORRELATION_WINDOW
        with open(_coherence_file) as f:
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
    if len(history) < 3:
        return {"status": "insufficient_data", "samples": len(history)}

    coherence_values = [e.get("coherence", 0.0) for e in history]
    shim_ms_values = [e.get("shim_ms") for e in history if e.get("shim_ms") is not None]

    avg_coherence = sum(coherence_values) / len(coherence_values)
    min_coherence = min(coherence_values)
    max_coherence = max(coherence_values)
    recent_5 = coherence_values[-5:] if len(coherence_values) >= 5 else coherence_values
    trend = (sum(recent_5) / len(recent_5)) - avg_coherence

    result = {
        "status": "active",
        "samples": len(history),
        "window_s": _CORRELATION_WINDOW,
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

    # Dip frequency: how often coherence drops below 0.7 in the window
    dips = sum(1 for c in coherence_values if c < 0.7)
    if dips > 0:
        result["dip_count"] = dips
        result["dip_rate_per_hour"] = round(dips / (_CORRELATION_WINDOW / 3600), 1)
        if dips >= 5:
            result["alerts"].append({
                "type": "frequent_instability",
                "message": f"{dips} coherence dips (<0.7) in last hour — systemic instability",
            })

    # Ops state cross-reference
    try:
        with open(_ops_file) as f:
            ops = json.load(f)
        restarts = ops.get("restarts_today", 0)
        shim_crashes = ops.get("shim_crashes_today", 0)
        if restarts >= 5 and min_coherence < 0.5:
            result["alerts"].append({
                "type": "restart_churn",
                "message": f"{restarts} MCP restarts today with coherence dips — crash loop pattern",
            })
        if shim_crashes >= 2 and len(shim_ms_values) >= 3 and recent_ms > 1000:
            result["alerts"].append({
                "type": "shim_decay_precursor",
                "message": f"{shim_crashes} shim crashes + rising latency — next crash imminent",
            })
    except (OSError, json.JSONDecodeError):
        pass

    return result


# ── Layer 15: Prescriptive Narrator ────────────────────────────────────────

def _narrate(monitor_status: dict, correlations: dict) -> str:
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
                         "If recurring, investigate Ollama memory pressure or shim resource exhaustion.")
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

    # Prescriptive guidance
    if any(a.get("type") == "shim_decay_precursor" for a in correlations.get("alerts", [])):
        parts.append("ACTION: Preemptively restart shim before the next crash to avoid cascade disruption.")
    elif any(a.get("type") == "restart_churn" for a in correlations.get("alerts", [])):
        parts.append("ACTION: Investigate root cause of restart churn — check OOM, port conflicts, or hanging threads.")
    elif any(a.get("type") == "coherence_declining" for a in correlations.get("alerts", [])):
        parts.append("ACTION: Monitor closely. If decline continues, run status(mode='health') for full diagnostic.")
    elif any(a.get("type") == "gpu_memory_pressure" for a in _last_env_snapshot.get("alerts", [])):
        parts.append("ACTION: GPU memory critical — consider unloading unused models or reducing batch size.")

    return " ".join(parts)


def _write_narrative(narrative: str) -> None:
    try:
        entry = json.dumps({"ts": time.time(), "narrative": narrative})
        with open(_narrative_file, "a") as f:
            f.write(entry + "\n")
        _trim_narrative_file()
    except OSError as e:
        logger.warning(f"Meta-observer L15: narrative write failed: {e}")


def _trim_narrative_file() -> None:
    try:
        with open(_narrative_file) as f:
            lines = f.readlines()
        if len(lines) > _MAX_NARRATIVE_LINES:
            with open(_narrative_file, "w") as f:
                f.writelines(lines[-_MAX_NARRATIVE_LINES:])
    except OSError:
        pass


def _read_last_narrative() -> dict | None:
    try:
        with open(_narrative_file) as f:
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


# ── Layer 16: Environmental Awareness ──────────────────────────────────────

_last_env_snapshot: dict = {}


def _scan_environment() -> dict:
    env = {"ts": time.time()}

    # Disk space for project root
    try:
        usage = shutil.disk_usage(os.environ.get("PROJECT_ROOT", "/"))
        env["disk_free_gb"] = round(usage.free / (1024 ** 3), 1)
        env["disk_pct_used"] = round((usage.used / usage.total) * 100, 1)
    except OSError:
        pass

    # System load average (1, 5, 15 min)
    try:
        load = os.getloadavg()
        env["load_1m"] = round(load[0], 2)
        env["load_5m"] = round(load[1], 2)
        env["load_15m"] = round(load[2], 2)
    except OSError:
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
                    used, total, free = int(parts[1]), int(parts[2]), int(parts[3])
                    gpus.append({
                        "index": int(parts[0]),
                        "used_mb": used,
                        "total_mb": total,
                        "free_mb": free,
                        "pct_used": round((used / max(total, 1)) * 100, 1),
                    })
            env["gpus"] = gpus
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass

    # Process RSS (own memory footprint)
    try:
        with open(f"/proc/{os.getpid()}/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    env["process_rss_mb"] = round(int(line.split()[1]) / 1024, 1)
                    break
    except OSError:
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
    if env.get("process_rss_mb", 0) > 2048:
        alerts.append({"type": "memory_bloat", "message": f"MCP process at {env['process_rss_mb']}MB RSS — possible memory leak"})
    env["alerts"] = alerts
    return env


# ── Layer 17: Conversation Entanglement ────────────────────────────────────

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

        # Operational state cross-reference
        try:
            with open(_ops_file) as f:
                ops = json.load(f)
            state["restarts_today"] = ops.get("restarts_today", 0)
            state["recovery_rate"] = ops.get("recovery_success_rate_ema")
            state["session_age_s"] = round(time.time() - ops.get("session_start", time.time()))
        except (OSError, json.JSONDecodeError):
            pass

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
            transcript_path = os.path.join(
                os.environ.get("PROJECT_ROOT", ""),
                "tools", "HME", "mcp", "log", "session-transcript.jsonl"
            )
            if os.path.exists(transcript_path):
                recent_files = set()
                with open(transcript_path) as f:
                    lines = f.readlines()
                for line in lines[-20:]:
                    try:
                        entry = json.loads(line.strip())
                        text = json.dumps(entry)
                        # Extract file paths mentioned
                        import re
                        paths = re.findall(r'(?:src|tools)/[\w/]+\.(?:js|py|ts)', text)
                        recent_files.update(paths[:5])
                    except (json.JSONDecodeError, ValueError):
                        continue
                if recent_files:
                    state["recent_files"] = sorted(recent_files)[:10]
        except OSError:
            pass

        # Write atomically
        tmp = _entanglement_file + ".tmp"
        with open(tmp, "w") as f:
            json.dump(state, f, indent=2)
        os.replace(tmp, _entanglement_file)
    except Exception as e:
        logger.warning(f"Meta-observer L17: entanglement checkpoint failed: {e}")


def _read_entanglement() -> dict | None:
    try:
        with open(_entanglement_file) as f:
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
    return "[HME state] " + " | ".join(parts) if parts else None


# ── Layer 18: Counterfactual Reasoning ─────────────────────────────────────

_predictions: list[dict] = []  # active predictions awaiting outcome


def record_prediction(prediction_type: str, predicted_outcome: str,
                      intervention: str | None = None, window_s: float = 600) -> str:
    """Record a prediction about what will happen. Returns prediction ID.

    If an intervention is taken, we later check whether the predicted
    outcome was actually prevented — building an effectiveness model.
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
            verb = "occurred" if outcome_occurred else "was prevented"
            logger.info(f"Meta-observer L18: {pred_id} resolved — predicted outcome {verb}"
                        f"{' (intervention: ' + pred['intervention'] + ')' if pred['intervention'] else ''}")
            return


def _expire_predictions() -> None:
    """Check for predictions past their deadline — if no outcome recorded, assume prevented."""
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
    # Prune resolved predictions older than 1 hour
    _predictions[:] = [p for p in _predictions if
                       p["outcome"] is None or
                       time.time() - p["outcome"].get("resolved_ts", 0) < 3600]


def _write_counterfactual(pred: dict) -> None:
    try:
        with open(_counterfactual_file, "a") as f:
            f.write(json.dumps(pred) + "\n")
    except OSError:
        pass


def _compute_effectiveness() -> dict:
    """Compute intervention effectiveness from counterfactual history."""
    try:
        if not os.path.exists(_counterfactual_file):
            return {"total_predictions": 0}
        resolved = []
        with open(_counterfactual_file) as f:
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


def _auto_predictions_from_correlator() -> None:
    """Generate predictions from L14 correlator alerts — feeding L18 automatically."""
    if not _last_correlations or not _last_correlations.get("alerts"):
        return
    for alert in _last_correlations["alerts"]:
        atype = alert.get("type", "")
        # Don't duplicate — check if we already have an active prediction for this type
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
                "coherence_decline",
                "coherence drops below 0.3 within 15 minutes",
                window_s=900,
            )
        elif atype == "shim_latency_spike":
            record_prediction(
                "shim_latency_crash",
                "shim becomes unreachable within 5 minutes",
                intervention="latency alert surfaced",
                window_s=300,
            )


# ── Main Loop ──────────────────────────────────────────────────────────────

_last_narration_ts: float = 0.0
_last_env_ts: float = 0.0
_last_entangle_ts: float = 0.0


def _meta_loop() -> None:
    global _last_correlations, _last_narration_ts, _last_env_ts, _last_entangle_ts
    global _last_env_snapshot
    cycle = 0
    while _active:
        try:
            time.sleep(_HEARTBEAT_INTERVAL)
            if not _active:
                break
            cycle += 1
            now = time.time()

            # L13: heartbeat + monitor check
            _write_heartbeat()
            monitor_status = {}
            if cycle % max(1, _MONITOR_CHECK_INTERVAL // _HEARTBEAT_INTERVAL) == 0:
                monitor_status = _check_monitor_alive()

            # L14: temporal correlation (every 2 minutes)
            if cycle % max(1, 120 // _HEARTBEAT_INTERVAL) == 0:
                history = _load_coherence_history()
                _last_correlations = _correlate(history)
                if _last_correlations.get("alerts"):
                    for alert in _last_correlations["alerts"]:
                        logger.warning(f"Meta-observer L14: {alert['type']} — {alert['message']}")

            # L15: narrative synthesis (includes L16 env data when available)
            if now - _last_narration_ts >= _NARRATION_INTERVAL and _last_correlations:
                if not monitor_status:
                    monitor_status = _check_monitor_alive()
                narrative = _narrate(monitor_status, _last_correlations)
                _write_narrative(narrative)
                _last_narration_ts = now
                logger.debug(f"Meta-observer L15: {narrative[:120]}...")

            # L16: environment scan
            if now - _last_env_ts >= _ENV_CHECK_INTERVAL:
                _last_env_snapshot = _scan_environment()
                _last_env_ts = now
                for alert in _last_env_snapshot.get("alerts", []):
                    logger.warning(f"Meta-observer L16: {alert['type']} — {alert['message']}")

            # L17: conversation entanglement checkpoint
            if now - _last_entangle_ts >= _ENTANGLE_INTERVAL:
                _checkpoint_entanglement()
                _last_entangle_ts = now

            # L18: expire stale predictions + generate new ones from correlator
            _expire_predictions()
            _auto_predictions_from_correlator()

        except Exception as e:
            logger.error(f"Meta-observer loop error: {e}")
            time.sleep(10)
