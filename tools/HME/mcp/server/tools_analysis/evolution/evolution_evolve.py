"""HME evolve — unified 'what should I work on next?' mega-tool.

Merges three data sources into one ranked evolution view:
1. LOC offenders (from codebase_health logic)
2. Coupling dimension gaps + leverage opportunities (from coupling_intel)
3. Pipeline evolution suggestions (from suggest_evolution, if fresh data)
"""
import os
import logging

from server import context as ctx
from server.onboarding_chain import chained
from .. import _track, _budget_gate, BUDGET_COMPOUND, BUDGET_TOOL
from ..synthesis_session import append_session_narrative

logger = logging.getLogger("HME")


@ctx.mcp.tool()
@chained("evolve")
def evolve(focus: str = "all", query: str = "") -> str:
    """Unified evolution intelligence hub. focus='all' (default): LOC offenders +
    coupling gaps + leverage + pipeline suggestions + synthesis.
    focus='loc': LOC offenders only.
    focus='pipeline': pipeline suggestions only.
    focus='patterns': journal meta-patterns across all rounds.
    focus='seed': auto-generate starter KB entries for high-dependency uncovered modules.
    focus='design': bridge design synthesis — proposes specific dimension, direction,
    code location, and musical rationale for top unsaturated antagonist pairs.
focus='curate': living memory curation — detects KB-worthy patterns from recent
    pipeline runs (trust gaps, feature extremes, verdict transitions) and proposes entries.
    focus='forge': verified skill recipes — generates lab sketches for top unsaturated
    antagonist bridges with executable monkey-patch code, ready to test.
    focus='contradict': contradiction detection — full KB pairwise scan finds entries
    that are semantically related but make conflicting claims. Surfaces contradictions
    with resolution suggestions (merge, supersede, or tag contradicts).
    focus='stress': adversarial self-play — runs enforcement probes against LIFESAVER,
    boundary rules, doc sync, hook registration, selftest, and other guardrails.
    Reports gaps in enforcement that could let violations slip through.
    focus='invariants': declarative invariant battery — loads checks from
    config/invariants.json and evaluates each one. Add new invariants as JSON
    without modifying Python.
    focus='think': deep reasoning about a question (pass question in query param).
    focus='blast': blast radius / transitive dependency chain (pass symbol in query).
    focus='coupling': coupling intelligence (pass sub-mode in query: full/network/antagonists/gaps/leverage)."""
    _track("evolve")
    append_session_narrative("evolve", f"evolve({focus})")
    ctx.ensure_ready_sync()
    parts = ["# Evolution Intelligence\n"]

    if focus in ("all", "loc"):
        parts.append(_loc_offenders())

    if focus == "all":
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

    if focus == "design":
        from ..coupling_bridges import design_bridges
        _design_out = design_bridges()
        # D1: append structured target marker so onboarding_chain can extract
        # the picked target deterministically even if design output format changes.
        try:
            from server.onboarding_chain import (
                emit_target_marker, _extract_target_from_evolve as _et
            )
            tgt = _et(_design_out)
            if tgt:
                _design_out = _design_out + "\n\n" + emit_target_marker(tgt)
        except Exception as _err1:
            logger.debug(f'silent-except evolution_evolve.py:83: {type(_err1).__name__}: {_err1}')
        return _design_out

    if focus == "curate":
        return _auto_curate()

    if focus == "forge":
        from ..coupling_bridges import forge_bridges
        return forge_bridges()

    if focus == "contradict":
        return _detect_contradictions()

    if focus == "stress":
        return _adversarial_stress()

    if focus == "invariants":
        from .evolution_invariants import check_invariants
        return check_invariants(verbose=(query or "").lower() == "verbose")

    if focus == "think":
        if not query:
            return "Error: focus='think' requires query param with the question."
        from ..reasoning_think import think as _th
        return _th(about=query)

    if focus == "blast":
        if not query:
            return "Error: focus='blast' requires query param with the symbol name."
        from ..reasoning_think import blast_radius as _br
        return _br(query)

    if focus == "coupling":
        from ..coupling import coupling_intel as _ci
        return _budget_gate(_ci(mode=query or "full"))

    if focus not in ("all", "loc", "pipeline"):
        return f"Unknown focus '{focus}'. Use: all, loc, pipeline, patterns, seed, design, curate, forge, contradict, stress, invariants, think, blast, coupling."

    budget = BUDGET_COMPOUND if focus == "all" else BUDGET_TOOL
    return _budget_gate("\n".join(parts), budget=budget)


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
    for fpath in walk_code_files():
        rel = str(fpath).replace(ctx.PROJECT_ROOT + "/", "")
        if not rel.startswith("src/"):
            continue
        try:
            lc = sum(1 for _ in open(fpath, encoding="utf-8", errors="ignore"))
        except Exception as _err:
            logger.debug(f"unnamed-except evolution_evolve.py:148: {type(_err).__name__}: {_err}")
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
        from ..coupling import dimension_gap_finder, antagonism_leverage
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
    from ..synthesis_session import get_session_narrative
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


# Heavy strategies split into evolution_strategies.py
from .evolution_strategies import _auto_curate, _detect_contradictions, _adversarial_stress  # noqa: E402, F401
