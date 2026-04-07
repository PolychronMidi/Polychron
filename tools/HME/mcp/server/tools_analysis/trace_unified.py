"""HME trace — unified signal flow tracing.

Merges trace_query (module/causal) + coupling_intel(cascade:X) into one tool.
"""
import logging

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def trace(target: str, mode: str = "auto", section: int = -1, limit: int = 15) -> str:
    """Trace signal flow through the system.
    'channelName' → L0 cascade trace (follow signal through consumers 3 hops deep).
    'moduleName' → per-section trace (regime, tension, notes, profile per section).
    mode='auto' (default) detects from target: known L0 channel names → cascade,
    otherwise → module trace. mode='cascade'|'module'|'causal' to force."""
    _track("trace")
    ctx.ensure_ready_sync()
    if not target or not target.strip():
        return "Error: target cannot be empty. Pass a channel name or module name."

    target = target.strip()

    if mode == "auto":
        mode = _detect_trace_type(target)

    if mode == "cascade":
        from .coupling import coupling_intel as _ci
        return _ci(mode=f"cascade:{target}")

    # Module or causal trace
    from .evolution_trace import trace_query as _tq
    return _tq(module=target, section=section, limit=limit, mode=mode if mode != "auto" else "module")


def _detect_trace_type(target: str) -> str:
    """Detect whether target is an L0 channel name or a module name."""
    # Known L0 channel name patterns: lowercase with hyphens
    if '-' in target:
        return "cascade"
    # camelCase = likely a module
    if any(c.isupper() for c in target[1:]):
        return "module"
    # All lowercase, no hyphens — check known channels
    _KNOWN_CHANNELS = {
        "articulation", "chord", "coherence", "density", "entropy",
        "harmonic", "onset", "spectral", "tension", "velocity",
    }
    if target in _KNOWN_CHANNELS:
        return "cascade"
    return "module"
