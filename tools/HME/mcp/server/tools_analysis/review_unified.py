"""HME review — unified post-pipeline analysis tool.

Merges pipeline_digest, regime_report, trust_report, section_compare,
and audio_analyze into one tool with mode routing.
"""
import logging

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def review(mode: str = "digest", section_a: int = -1, section_b: int = -1,
           system_a: str = "", system_b: str = "",
           critique: bool = False) -> str:
    """Post-pipeline review hub. mode='digest' (default): pipeline_digest with
    evolution suggestions. mode='regime': regime distribution + transition analysis.
    mode='trust': trust ecology report. mode='sections': compare two sections
    (requires section_a and section_b). mode='audio': perceptual audio analysis.
    mode='full': digest + regime + trust in one call."""
    _track("review")
    ctx.ensure_ready_sync()
    parts = []

    modes = [mode] if mode != "full" else ["digest", "regime", "trust"]

    for m in modes:
        if m == "digest":
            from .digest import pipeline_digest as _pd
            parts.append(_pd(evolve=True, critique=critique))
        elif m == "regime":
            from .section_compare import regime_report as _rr
            parts.append(_rr())
        elif m == "trust":
            from .trust_analysis import trust_report as _tr
            parts.append(_tr(system_a=system_a, system_b=system_b))
        elif m == "sections":
            if section_a < 0 or section_b < 0:
                parts.append("Error: sections mode requires section_a and section_b (0-indexed).")
            else:
                from .section_compare import section_compare as _sc
                parts.append(_sc(section_a, section_b))
        elif m == "audio":
            from .perceptual import audio_analyze as _aa
            parts.append(_aa())
        else:
            parts.append(f"Unknown mode '{m}'. Use: digest, regime, trust, sections, audio, full.")

    return "\n\n---\n\n".join(parts) if len(parts) > 1 else parts[0] if parts else "No data."
