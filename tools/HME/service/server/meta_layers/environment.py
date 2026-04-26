"""Layer 15: environment scan + entanglement checkpointing."""
from __future__ import annotations

import json
import logging
import os
import shutil
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


_shared._last_env_snapshot: dict = {}


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
        if _shared._last_correlations:
            state["coherence_avg"] = _shared._last_correlations.get("coherence_avg")
            state["coherence_trend"] = _shared._last_correlations.get("coherence_trend")
            state["active_alerts"] = [a["type"] for a in _shared._last_correlations.get("alerts", [])]
            state["dip_count"] = _shared._last_correlations.get("dip_count", 0)

        # What the environment shows
        if _shared._last_env_snapshot:
            state["disk_pct"] = _shared._last_env_snapshot.get("disk_pct_used")
            state["gpu_pressure"] = any(
                g.get("free_mb", 9999) < 1000
                for g in _shared._last_env_snapshot.get("gpus", [])
            )
            state["process_rss_mb"] = _shared._last_env_snapshot.get("process_rss_mb")

        # Operational state cross-reference + L19/L21
        try:
            with open(_shared._ms.ops_file) as f:
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

        # Last narrative (the system's own interpretation). Lazy imports
        # from sibling submodules — explicit cross-submodule imports here
        # would create a circular graph when every module initializes at
        # the same time.
        from .narrative import _read_last_narrative
        from .predictions import _compute_effectiveness
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
        tmp = _shared._ms.entanglement_file + ".tmp"
        with open(tmp, "w") as f:
            json.dump(state, f, indent=2)
        os.replace(tmp, _shared._ms.entanglement_file)
    except Exception as e:
        logger.warning(f"Meta-observer L17: entanglement checkpoint failed: {e}")


def _read_entanglement() -> dict | None:
    try:
        with open(_shared._ms.entanglement_file) as f:
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
