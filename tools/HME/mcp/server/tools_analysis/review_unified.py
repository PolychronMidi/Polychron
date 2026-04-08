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
           system_a: str = "", system_b: str = "", changed_files: str = "",
           file_path: str = "", critique: bool = False) -> str:
    """Unified review hub. mode='digest' (default): pipeline_digest + evolution suggestions.
    mode='regime': regime distribution + transition analysis.
    mode='trust': trust ecology (system_a/system_b for rivalry mode).
    mode='sections': compare two sections (section_a, section_b required).
    mode='audio': perceptual audio analysis.
    mode='composition': section arc + drama + hotspot leaderboard.
    mode='health': codebase health sweep (LOC, boundary violations, conventions).
    mode='forget': what_did_i_forget check (changed_files='file1.js,file2.js').
    mode='convention': convention check for a specific file (file_path required).
    mode='symbols': symbol audit (dead code + importance).
    mode='docs': doc sync check.
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
        elif m == "composition":
            from .composition import composition_events as _ce
            parts.append(_ce(mode="full"))
        elif m == "health":
            from .health import codebase_health as _ch
            parts.append(_ch())
        elif m == "forget":
            from .workflow_audit import what_did_i_forget as _wdif
            parts.append(_wdif(changed_files or ""))
        elif m == "convention":
            if not file_path:
                parts.append("Error: convention mode requires file_path.")
            else:
                from .health import convention_check as _cc
                parts.append(_cc(file_path))
        elif m == "symbols":
            from .health import symbol_audit as _sa
            parts.append(_sa())
        elif m == "docs":
            from .health import doc_sync_check as _ds
            parts.append(_ds())
        else:
            parts.append(f"Unknown mode '{m}'. Use: digest, regime, trust, sections, audio, composition, health, forget, convention, symbols, docs, full.")

    result = "\n\n---\n\n".join(parts) if len(parts) > 1 else parts[0] if parts else "No data."

    # Auto-draft KB entry after digest with run delta
    if "digest" in modes and "Run Delta" in result and "ALL CLEAR" in result:
        result += ("\n\n## Quick KB Draft\n"
                   "  Pipeline STABLE + regime health ALL CLEAR. Save round with:\n"
                   "  learn(title='RXX: ...describe evolutions...', content='...run delta + what changed...', "
                   "category='pattern', listening_notes='...')")

    return result
