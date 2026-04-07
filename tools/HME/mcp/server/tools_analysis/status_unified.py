"""HME status — unified health check.

Merges check_pipeline + hme_admin(selftest) into one 'is everything OK?' call.
Auto-warms stale GPU contexts when detected.
"""
import logging

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def status() -> str:
    """Is everything OK? Pipeline status + system health in one call.
    Auto-kicks background warm prime when stale contexts detected."""
    _track("status")
    ctx.ensure_ready_sync()
    parts = []

    # Pipeline status
    try:
        from .digest import check_pipeline as _cp
        pipeline = _cp()
        parts.append(f"## Pipeline\n  {pipeline}")
    except Exception as e:
        parts.append(f"## Pipeline\n  Error: {e}")

    # System health (selftest)
    try:
        from .evolution_admin import hme_selftest as _st
        selftest = _st()
        parts.append(selftest)
    except Exception as e:
        parts.append(f"## Self-Test\n  Error: {e}")

    # Auto-warm if stale contexts detected
    try:
        from .synthesis import warm_context_status
        wcs = warm_context_status()
        stale_models = []
        for model_name, info in wcs.items():
            if model_name in ("arbiter", "think_history", "session_narrative"):
                continue
            if isinstance(info, dict) and info.get("primed") and not info.get("kb_fresh"):
                stale_models.append(model_name)
        if stale_models:
            parts.append(f"\n## Auto-Warm\n  Stale contexts detected: {', '.join(m[:20] for m in stale_models)}")
            parts.append("  Kicking background warm prime...")
            try:
                from .synthesis_warm import _prime_all_gpus
                import threading
                t = threading.Thread(target=_prime_all_gpus, daemon=True)
                t.start()
                parts.append("  Background warm prime started.")
            except Exception as e:
                parts.append(f"  Warm prime failed: {e}")
    except Exception:
        pass

    return "\n\n".join(parts)
