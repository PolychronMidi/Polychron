"""HME evolve — unified 'what should I work on next?' mega-tool.

Merges three data sources into one ranked evolution view:
1. LOC offenders (from codebase_health logic)
2. Coupling dimension gaps + leverage opportunities (from coupling_intel)
3. Pipeline evolution suggestions (from suggest_evolution, if fresh data)
"""
import os
import logging

from server import context as ctx
from . import _track
from .synthesis_session import append_session_narrative

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def evolve(focus: str = "all") -> str:
    """Unified evolution intelligence hub. focus='all' (default): LOC offenders +
    coupling gaps + leverage + pipeline suggestions + synthesis.
    focus='coupling': coupling gaps + leverage only.
    focus='loc': LOC offenders only.
    focus='pipeline': pipeline suggestions only.
    focus='patterns': journal meta-patterns across all rounds.
    focus='seed': auto-generate starter KB entries for high-dependency uncovered modules."""
    _track("evolve")
    append_session_narrative("evolve", f"evolve({focus})")
    ctx.ensure_ready_sync()
    parts = ["# Evolution Intelligence\n"]

    if focus in ("all", "loc"):
        parts.append(_loc_offenders())

    if focus in ("all", "coupling"):
        parts.append(_coupling_opportunities())

    if focus in ("all", "pipeline"):
        parts.append(_pipeline_suggestions())

    if focus == "all":
        parts.append(_synthesis())

    if focus == "patterns":
        from .evolution import evolution_patterns
        return evolution_patterns()

    if focus == "seed":
        from .evolution import kb_seed
        return kb_seed()

    return "\n".join(parts)


_loc_cache: dict = {"result": "", "ts": 0.0}
_LOC_CACHE_TTL = 120.0


def _loc_offenders(top_n: int = 8) -> str:
    """Top LOC offenders from src/. Cached for 120s since file counts rarely change mid-session."""
    import time as _time
    now = _time.monotonic()
    if _loc_cache["result"] and (now - _loc_cache["ts"]) < _LOC_CACHE_TTL:
        return _loc_cache["result"]

    from file_walker import walk_code_files
    from server.helpers import LINE_COUNT_TARGET, LINE_COUNT_CRITICAL

    oversize = []
    for fpath in walk_code_files(ctx.PROJECT_ROOT):
        rel = str(fpath).replace(ctx.PROJECT_ROOT + "/", "")
        if not rel.startswith("src/"):
            continue
        try:
            lc = sum(1 for _ in open(fpath, encoding="utf-8", errors="ignore"))
        except Exception:
            continue
        if lc > LINE_COUNT_CRITICAL:
            oversize.append((rel, lc))
    oversize.sort(key=lambda x: -x[1])
    if not oversize:
        result = "## LOC: all src/ files under target"
    else:
        lines = [f"## LOC Offenders ({len(oversize)} files > {LINE_COUNT_CRITICAL} lines)\n"]
        for rel, lc in oversize[:top_n]:
            lines.append(f"  {lc:>4} lines  {rel}")
        if len(oversize) > top_n:
            lines.append(f"  ... and {len(oversize) - top_n} more")
        result = "\n".join(lines)
    _loc_cache["result"] = result
    _loc_cache["ts"] = now
    return result


def _coupling_opportunities() -> str:
    """Dimension gaps + top unsaturated leverage pairs."""
    parts = []
    try:
        from .coupling import dimension_gap_finder, antagonism_leverage
        gaps = dimension_gap_finder()
        # Extract just the gap lines (compact)
        gap_lines = [l for l in gaps.split("\n") if l.strip().startswith("x") or "x " in l]
        if gap_lines:
            parts.append("## Coupling Gaps (lowest coverage first)\n")
            for gl in gap_lines[:6]:
                parts.append(f"  {gl.strip()}")
        # Leverage: only unsaturated pairs
        lev = antagonism_leverage(pair_limit=4)
        unsaturated = []
        for block in lev.split("## r="):
            if "SATURATED" not in block and block.strip():
                header = block.split("\n")[0].strip()
                unsaturated.append(f"  r={header[:80]}")
        if unsaturated:
            parts.append(f"\n## Unsaturated Antagonist Pairs ({len(unsaturated)} available)\n")
            for u in unsaturated[:4]:
                parts.append(u)
        elif "SATURATED" in lev:
            parts.append("\n## Antagonist Pairs: all top pairs fully saturated")
    except Exception as e:
        parts.append(f"## Coupling: error — {e}")
    return "\n".join(parts) if parts else "## Coupling: no data"


def _pipeline_suggestions() -> str:
    """Evolution suggestions from last pipeline run."""
    try:
        from .evolution_suggest import suggest_evolution
        result = suggest_evolution()
        if result and len(result) > 50:
            # Compact: take just the ranked proposals section
            proposals_start = result.find("## Ranked")
            if proposals_start == -1:
                proposals_start = result.find("## Evolution")
            if proposals_start == -1:
                proposals_start = 0
            return result[proposals_start:proposals_start + 2000]
        return "## Pipeline Suggestions: no fresh data (run pipeline first)"
    except Exception as e:
        return f"## Pipeline Suggestions: error — {e}"


def _synthesis() -> str:
    """Dynamic priority synthesis from session context + data signals."""
    from .synthesis_session import get_session_narrative
    narrative = get_session_narrative(max_entries=5, categories=["pipeline", "kb", "evolve", "edit"])
    lines = ["\n## Priority Synthesis\n"]
    if narrative:
        lines.append(narrative.strip())
        lines.append("")
    lines.append("Highest-impact actions (from combined signals above):")
    lines.append("  1. Split the worst LOC offender (reduces cognitive load + enables coupling)")
    lines.append("  2. Bridge the top unsaturated antagonist pair (maximum musical texture impact)")
    lines.append("  3. Add coupling to uncoupled high-trust modules (leverages existing quality)")
    return "\n".join(lines)
