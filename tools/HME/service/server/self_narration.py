"""HME self-narration — Layer 6 of the self-coherence stack.

Assembles a rich, contextual status narrative from all available signals:
  - System phase and lifecycle history (Layer 0)
  - Operational memory: restart count, crash frequency, recovery rate (Layer 2)
  - Health topology: shim, daemon, llama.cpp models (Layer 3)
  - Failure genealogy: active causal chains (Layer 4)
  - Resonance status: cascade in progress? (Layer 10)

The narration is prepended to tool responses when the system is not READY,
giving Claude actionable context instead of a bare "[DEGRADED]" status flag.

Format: compact paragraph (not a table) — enough context to reason about
trustworthiness of search results without overwhelming the tool response.
"""
import time
import logging

logger = logging.getLogger("HME")


def build_status_narrative() -> str:
    """Assemble rich status narrative from all self-coherence layers.

    Returns empty string if system is fully READY — no banner needed.
    All imports are lazy to avoid circular imports at module load time.
    """
    try:
        from server import system_phase as sp
        phase = sp.get_phase()
        if phase == sp.SystemPhase.READY:
            return ""  # healthy — suppress banner entirely

        from server import operational_state as ops
        from server import health_topology as ht
        from server import resonance_detector as rd

        phase_desc = sp.describe_phase()
        snap = ops.snapshot()
        topo = ht.get_topology()
        topo_desc = ht.describe_topology(topo)
        coherence = topo.get("coherence", 0.0)
        cascade = rd.get_cascade_info()

        restarts = snap.get("restarts_today", 1)
        shim_crashes = snap.get("shim_crashes_today", 0)
        session_start = snap.get("session_start", time.time())
        session_age_min = int((time.time() - session_start) / 60)
        recovery_rate = snap.get("recovery_success_rate_ema", 1.0)
        startup_ms = snap.get("startup_ms_ema")

        lines = [f"\n[HME STATUS] System is {phase_desc}."]

        # Session lifecycle context
        ctx_parts = []
        if restarts > 1:
            ctx_parts.append(f"restart #{restarts} today")
        if shim_crashes > 0:
            ctx_parts.append(f"{shim_crashes} shim crash(es) this session")
        if session_age_min > 0:
            ctx_parts.append(f"session age {session_age_min}m")
        if startup_ms:
            ctx_parts.append(f"typical startup {startup_ms:.0f}ms")
        if ctx_parts:
            lines.append("Context: " + ", ".join(ctx_parts) + ".")

        # Component health
        lines.append(f"Components: {topo_desc}.")

        # Slowdown warning (Layer 7)
        slowdown = topo.get("slowdown_warning")
        if slowdown:
            lines.append(
                f"⚠ Predictive: {slowdown['message']}."
            )

        # Cascade (Layer 10)
        if cascade:
            lines.append(
                f"CASCADE in progress: {len(cascade['sources'])} components failed "
                f"within {cascade['age_s']:.0f}s ({', '.join(cascade['sources'])}). "
                "Individual restart attempts suppressed; orchestrated recovery running."
            )

        # Recovery health
        if recovery_rate < 0.8:
            lines.append(
                f"Recovery success rate is {recovery_rate:.0%} — the system has been struggling to self-heal. "
                "Consider restarting the shim manually: kill $(cat /tmp/hme-http-shim.pid)"
            )

        # Crash loop (Layer 5)
        if ops.is_crash_loop():
            lines.append(
                "Crash loop pattern detected (≥3 shim crashes or ≥8 restarts today). "
                "Expensive startup steps (llama.cpp priming, cache warm) are being skipped. "
                "Check system resources: OOM, disk full, CUDA errors."
            )

        # Coherence summary (Layer 8)
        if coherence < 0.5:
            lines.append(
                f"System coherence {coherence:.0%} — multiple components degraded simultaneously."
            )

        # Phase-specific guidance
        if phase == sp.SystemPhase.RECOVERING:
            lines.append(
                "Search results may be incomplete until shim is fully ready. "
                "RAG calls will return empty lists during recovery."
            )
        elif phase == sp.SystemPhase.DEGRADED:
            lines.append("Search results may be empty. Shim restart may have been triggered automatically.")
        elif phase == sp.SystemPhase.FAILED:
            lines.append(
                "No RAG operations available. Restart the MCP server to recover. "
                "If this persists, check log/hme.log for the startup error."
            )
        elif phase == sp.SystemPhase.WARMING:
            lines.append("Engines initializing — tool calls will block up to 45s.")

        return " ".join(lines) + "\n\n"

    except Exception as e:
        logger.debug(f"self_narration failed: {e}")
        return ""
