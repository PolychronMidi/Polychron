"""HME status — unified system health and status hub.

Merges check_pipeline + hme_admin(selftest) + coupling overview + trust ecology
into one 'is everything OK?' call with mode selection.
Auto-warms stale GPU contexts when detected.
"""
import logging

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def status(mode: str = "all") -> str:
    """System health hub. mode='all' (default): pipeline + selftest + auto-warm.
    mode='pipeline': pipeline status only. mode='health': codebase health sweep.
    mode='coupling': coupling topology + antagonist tensions + dimension gaps.
    mode='trust': trust ecology leaderboard (all 27 systems, 200-beat sample).
    mode='perceptual': perceptual stack status (EnCodec/CLAP/verdict model).
    mode='hme': HME selftest + introspection."""
    _track("status")
    ctx.ensure_ready_sync()

    if mode == "pipeline":
        from .digest import check_pipeline as _cp
        return _cp()

    if mode == "health":
        from .health import codebase_health as _ch
        return _ch()

    if mode == "coupling":
        from .coupling import coupling_intel as _ci
        return _ci(mode="full")

    if mode == "trust":
        from .trust_analysis import trust_report as _tr
        return _tr("", "")

    if mode == "perceptual":
        from .perceptual import audio_analyze as _aa
        try:
            return _aa(analysis="both")
        except Exception as e:
            err = str(e).lower()
            if "cuda" in err or "out of memory" in err or "oom" in err or "gpu" in err:
                # Check if pipeline is running (likely cause of GPU contention)
                try:
                    from .digest import check_pipeline as _cp_check
                    pipeline_status = _cp_check()
                    if "IN PROGRESS" in pipeline_status or "BLOCKED" in pipeline_status:
                        return ("Perceptual analysis unavailable: GPU busy (composition pipeline is running).\n"
                                "Re-run after pipeline completes.")
                except Exception:
                    pass
                return ("Perceptual analysis unavailable: GPU out of memory.\n"
                        "Another process may be using the GPU. Check with `nvidia-smi`.")
            return f"Perceptual analysis unavailable: {e}"

    if mode == "hme":
        from .evolution_admin import hme_selftest as _st
        return _st()

    if mode == "introspect":
        from .evolution_admin import hme_introspect as _hi
        return _hi()

    # mode == "all" — unified overview
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
        unprimed_models = []
        for model_name, info in wcs.items():
            if model_name in ("arbiter", "think_history", "session_narrative"):
                continue
            if isinstance(info, dict):
                if info.get("primed") and not info.get("kb_fresh"):
                    stale_models.append(model_name)
                elif not info.get("primed"):
                    unprimed_models.append(model_name)
        needs_warm = stale_models or unprimed_models
        if needs_warm:
            label = []
            if stale_models:
                label.append(f"stale: {', '.join(m[:20] for m in stale_models)}")
            if unprimed_models:
                label.append(f"unprimed: {', '.join(m[:20] for m in unprimed_models)}")
            parts.append(f"\n## Auto-Warm\n  Contexts need priming ({'; '.join(label)})")
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
