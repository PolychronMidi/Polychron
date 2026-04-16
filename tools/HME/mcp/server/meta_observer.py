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
import sys
import threading
import time
from dataclasses import dataclass, field

_mcp_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402

logger = logging.getLogger("HME")

_HEARTBEAT_INTERVAL = 30     # seconds between meta-observer heartbeats
_MONITOR_CHECK_INTERVAL = 45 # seconds between monitor-thread liveness checks
_CORRELATION_WINDOW = 3600   # 1 hour of coherence history for pattern detection
_NARRATION_INTERVAL = 300    # 5 minutes between narrative synthesis cycles
_MAX_NARRATIVE_LINES = 500   # cap narrative JSONL size
_ENV_CHECK_INTERVAL = 180    # 3 minutes between environment scans
_ENTANGLE_INTERVAL = 120     # 2 minutes between conversation checkpoints
_COUNTERFACTUAL_FILE_SUFFIX = "hme-counterfactuals.jsonl"


@dataclass
class MetaState:
    """All file paths and runtime state for the meta-observer, initialized in start()."""
    heartbeat_file: str = ""
    coherence_file: str = ""
    narrative_file: str = ""
    ops_file: str = ""
    counterfactual_file: str = ""
    entanglement_file: str = ""
    synthesis_file: str = ""           # hme-synthesis.jsonl (L19/L20)
    synthesis_patterns_file: str = ""  # hme-synthesis-patterns.json (L∞)


_active = False
_thread: threading.Thread | None = None
_ms = MetaState()  # populated by start(); safe to read as empty strings before then


def start(project_root: str) -> None:
    global _active, _thread, _ms
    if _active:
        return
    _ms = MetaState(
        heartbeat_file=os.path.join(project_root, "tmp", "hme-meta-observer.heartbeat"),
        coherence_file=os.path.join(project_root, "metrics", "hme-coherence.jsonl"),
        narrative_file=os.path.join(project_root, "metrics", "hme-narrative.jsonl"),
        ops_file=os.path.join(project_root, "tmp", "hme-ops.json"),
        counterfactual_file=os.path.join(project_root, "metrics", _COUNTERFACTUAL_FILE_SUFFIX),
        entanglement_file=os.path.join(project_root, "tmp", "hme-entanglement.json"),
        synthesis_file=os.path.join(project_root, "metrics", "hme-synthesis.jsonl"),
        synthesis_patterns_file=os.path.join(project_root, "metrics", "hme-synthesis-patterns.json"),
    )
    os.makedirs(os.path.dirname(_ms.heartbeat_file), exist_ok=True)
    os.makedirs(os.path.dirname(_ms.narrative_file), exist_ok=True)

    # Wire shared state into meta_layers BEFORE calling any layer functions
    meta_layers._ms = _ms

    gap = meta_layers._detect_observation_gap()
    if gap:
        logger.warning(f"Meta-observer: observation gap detected — {gap}")

    if not os.path.exists(_ms.synthesis_file):
        logger.info("Meta-observer: hme-synthesis.jsonl absent — L22/L25/L∞ layers dormant until first synthesis call")
    _active = True
    _thread = threading.Thread(target=_meta_loop, daemon=True, name="hme-meta-observer")
    _thread.start()
    logger.info("Meta-observer started (L13-L35+L∞∞: monitor, correlator, narrator, causal, lookahead, intent, routing, thermo, archaeology, ceiling)")


def stop() -> None:
    global _active
    _active = False


def get_status() -> dict:
    status = {
        "active": _active,
        "thread_alive": _thread.is_alive() if _thread else False,
        "last_heartbeat": meta_layers._read_heartbeat(),
        "last_narrative": meta_layers._read_last_narrative(),
        "correlations": _last_correlations.copy(),
        "environment": _last_env_snapshot.copy(),
        "entanglement": _read_entanglement(),
        "counterfactual_effectiveness": _compute_effectiveness(),
        "intent": _current_intent.copy(),
        "unprovable_claims": len(_UNPROVABLE_CLAIMS),
    }
    # L∞∞: coherence ceiling
    ceiling = meta_layers._check_coherence_ceiling()
    if ceiling:
        status["coherence_ceiling"] = ceiling
    return status



# Layer implementations extracted to meta_layers.py
from . import meta_layers  # noqa: E402

# Re-export public functions so callers can still use meta_observer.X
read_startup_narrative = meta_layers.read_startup_narrative
register_monitor_thread = meta_layers.register_monitor_thread
read_entanglement_for_compaction = meta_layers.read_entanglement_for_compaction
record_prediction = meta_layers.record_prediction
resolve_prediction = meta_layers.resolve_prediction
get_current_intent = meta_layers.get_current_intent

# Loop state — maintained here since meta_layers functions are stateless callables
_last_correlations: dict = {}
_last_env_snapshot: dict = {}
_last_narration_ts: float = 0.0
_last_env_ts: float = 0.0
_last_entangle_ts: float = 0.0
_last_synthesis_pattern_ts: float = 0.0
_last_intent_ts: float = 0.0
_last_archaeology_ts: float = 0.0
_last_kb_confidence_ts: float = 0.0
_current_intent: dict = {}

_KB_CONFIDENCE_INTERVAL = 3600      # 1 hour
_SYNTHESIS_PATTERN_INTERVAL = 1800  # 30 minutes
_INTENT_INTERVAL = 120              # 2 minutes
_ARCHAEOLOGY_INTERVAL = 21600       # 6 hours
_ALERT_LOG_COOLDOWN = 1800          # each alert type logs at most once per 30 minutes
_UNPROVABLE_CLAIMS: list = []


def _read_entanglement() -> dict:
    try:
        if _ms.entanglement_file and os.path.isfile(_ms.entanglement_file):
            import json as _j
            return _j.load(open(_ms.entanglement_file))
    except Exception:
        pass
    return {}


def _compute_effectiveness() -> dict:
    return {}  # placeholder — full implementation in meta_layers


def _meta_loop() -> None:
    global _last_correlations, _last_narration_ts, _last_env_ts, _last_entangle_ts
    global _last_env_snapshot, _last_synthesis_pattern_ts
    global _last_intent_ts, _last_archaeology_ts, _last_kb_confidence_ts
    _alert_last_logged: dict[str, float] = {}
    cycle = 0
    while _active:
        try:
            time.sleep(_HEARTBEAT_INTERVAL)
            if not _active:
                break
            cycle += 1
            now = time.time()

            # L13: heartbeat + monitor check
            meta_layers._write_heartbeat()
            monitor_status = {}
            if cycle % max(1, _MONITOR_CHECK_INTERVAL // _HEARTBEAT_INTERVAL) == 0:
                monitor_status = meta_layers._check_monitor_alive()

            # L14: temporal correlation (every 2 minutes) — includes L23 multi-timescale update
            if cycle % max(1, 120 // _HEARTBEAT_INTERVAL) == 0:
                history = meta_layers._load_coherence_history()
                _last_correlations = meta_layers._correlate(history)
                if _last_correlations.get("alerts"):
                    for alert in _last_correlations["alerts"]:
                        atype = alert["type"]
                        last = _alert_last_logged.get(atype, 0)
                        if now - last >= _ALERT_LOG_COOLDOWN:
                            logger.warning(f"Meta-observer L14: {atype} — {alert['message']}")
                            _alert_last_logged[atype] = now

            # L15: narrative synthesis + L24 anticipatory lookahead + L∞∞ ceiling check
            if now - _last_narration_ts >= _NARRATION_INTERVAL and _last_correlations:
                if not monitor_status:
                    monitor_status = meta_layers._check_monitor_alive()
                narrative = meta_layers._narrate(monitor_status, _last_correlations)
                meta_layers._write_narrative(narrative)
                _last_narration_ts = now
                # L24: lookahead runs alongside narration
                lookahead = meta_layers._anticipatory_lookahead()
                if lookahead and lookahead.get("intervention_needed"):
                    logger.warning(f"Meta-observer L24: {lookahead['suggestion']}")
                # L∞∞: coherence ceiling check
                ceiling = meta_layers._check_coherence_ceiling()
                if ceiling:
                    logger.warning(f"Meta-observer L∞∞: {ceiling['recommendation'][:120]}")
                logger.debug(f"Meta-observer L15: {narrative[:120]}...")

            # L16: environment scan
            if now - _last_env_ts >= _ENV_CHECK_INTERVAL:
                _last_env_snapshot = meta_layers._scan_environment()
                _last_env_ts = now
                for alert in _last_env_snapshot.get("alerts", []):
                    logger.warning(f"Meta-observer L16: {alert['type']} — {alert['message']}")

            # L17: conversation entanglement checkpoint
            if now - _last_entangle_ts >= _ENTANGLE_INTERVAL:
                meta_layers._checkpoint_entanglement()
                _last_entangle_ts = now

            # L32: intent classification (every 2 minutes, aligned with entanglement)
            if now - _last_intent_ts >= _INTENT_INTERVAL:
                meta_layers._classify_intent()
                _last_intent_ts = now

            # L∞: synthesis self-model + L22 causal attribution + L27 composition correlation
            if now - _last_synthesis_pattern_ts >= _SYNTHESIS_PATTERN_INTERVAL:
                meta_layers._detect_synthesis_patterns()
                attrib = meta_layers._causal_attribution()
                if attrib and attrib.get("status") == "attributed":
                    logger.debug(
                        f"Meta-observer L22: phantom attribution — "
                        f"primary={attrib['primary_cause']} (r={attrib['primary_correlation']:.2f})"
                    )
                meta_layers._correlate_composition_runs()
                _last_synthesis_pattern_ts = now

            # L28: living KB confidence (every hour)
            if now - _last_kb_confidence_ts >= _KB_CONFIDENCE_INTERVAL:
                meta_layers._update_kb_confidence()
                _last_kb_confidence_ts = now

            # L33: cross-session archaeology (every 6 hours)
            if now - _last_archaeology_ts >= _ARCHAEOLOGY_INTERVAL:
                arch = _session_archaeology()
                if arch and arch.get("finding"):
                    logger.info(f"Meta-observer L33: {arch['finding']}")
                _last_archaeology_ts = now

            # L18: expire stale predictions + generate new ones from correlator
            _expire_predictions()
            _auto_predictions_from_correlator()

            # L30: periodic session document snapshot (every 10 minutes)
            if cycle % max(1, 600 // _HEARTBEAT_INTERVAL) == 0:
                try:
                    from server import operational_state
                    operational_state.write_session_document()
                except Exception as _err7:
                    logger.debug(f"operational_state.write_session_document: {type(_err7).__name__}: {_err7}")

        except Exception as e:
            logger.error(f"Meta-observer loop error: {e}")
            time.sleep(10)
