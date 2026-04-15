"""HME evolution intelligence — journal patterns and KB seeding.

Split into focused modules:
  evolution_trace.py  — trace_query, interaction_map, causal_trace
  evolution_admin.py  — hme_admin, selftest, hot-reload, introspection, antipattern enforcement
"""
import json
import os
import re
import logging

from server import context as ctx
from server.helpers import get_context_budget, validate_project_path, fmt_score, BUDGET_LIMITS, SUBSYSTEM_NAMES
from symbols import find_callers as _find_callers
from .synthesis import (
    _local_think, _THINK_MODEL, _REASONING_MODEL,
    _get_max_tokens, _get_effort, _get_tool_budget,
)
from . import _get_compositional_context, _track, _usage_stats

logger = logging.getLogger("HME")

# Re-export everything that other modules import from evolution.py
from .evolution_trace import trace_query, interaction_map, causal_trace  # noqa: F401
from .evolution_admin import (  # noqa: F401
    hme_admin, hme_selftest, hme_introspect, hme_hot_reload,
    hme_inspect, fix_antipattern,
)


def evolution_patterns() -> str:
    """Analyze metrics/journal.md for meta-patterns across evolution rounds."""
    ctx.ensure_ready_sync()
    _track("evolution_patterns")

    journal_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "journal.md")
    if not os.path.isfile(journal_path):
        return "No journal.md found."

    try:
        with open(journal_path, encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        return f"Error reading journal: {e}"

    # Extract round data
    round_sections = re.findall(
        r'## (R\d+)\s+.*?—\s+\d{4}-\d{2}-\d{2}\s+—\s+(\w+)',
        content
    )
    if not round_sections:
        return "No round entries found in journal."

    total_rounds = len(round_sections)
    verdicts = [v for _, v in round_sections]

    # Verdict distribution
    verdict_counts: dict = {}
    for v in verdicts:
        v_upper = v.upper()
        verdict_counts[v_upper] = verdict_counts.get(v_upper, 0) + 1

    # Subsystem mention frequency
    subsystem_mentions: dict = {}
    for sub in SUBSYSTEM_NAMES:
        count = len(re.findall(rf'\b{sub}\b', content, re.IGNORECASE))
        if count > 0:
            subsystem_mentions[sub] = count

    # Module frequency in evolution entries
    module_mentions: dict = {}
    for m in re.findall(r'[a-z][a-zA-Z]{8,}', content):
        module_mentions[m] = module_mentions.get(m, 0) + 1

    # Signal/dimension usage patterns
    signal_mentions: dict = {}
    for sig in ["freshnessEma", "complexity", "density", "contourShape", "tessituraLoad",
                "ascendRatio", "registerMigrationDir", "hotspots", "biasStrength",
                "complexityEma", "densitySurprise", "intervalFreshness", "counterpoint",
                "thematicDensity"]:
        count = content.count(sig)
        if count > 0:
            signal_mentions[sig] = count

    out = [f"# Evolution Patterns ({total_rounds} rounds)\n"]

    out.append("## Verdict Distribution")
    for v, c in sorted(verdict_counts.items(), key=lambda x: -x[1]):
        bar = "x" * c
        rate = c / total_rounds * 100
        out.append(f"  {v:<15} {c:3} ({rate:.0f}%)  {bar}")
    legendary_rate = verdict_counts.get("LEGENDARY", 0) / total_rounds * 100
    out.append(f"\n  Legendary rate: {legendary_rate:.1f}%")

    # Recent trajectory
    recent = round_sections[-10:]
    recent_verdicts = [v.upper() for _, v in recent]
    out.append(f"\n## Recent Trajectory (last {len(recent)})")
    for rnd, v in recent:
        out.append(f"  {rnd}: {v}")

    # Streaks
    streaks = []
    current_streak = {"verdict": recent_verdicts[0], "count": 1}
    for v in recent_verdicts[1:]:
        if v == current_streak["verdict"]:
            current_streak["count"] += 1
        else:
            streaks.append(current_streak)
            current_streak = {"verdict": v, "count": 1}
    streaks.append(current_streak)
    if streaks:
        longest = max(streaks, key=lambda s: s["count"])
        out.append(f"  Longest recent streak: {longest['count']}x {longest['verdict']}")

    out.append(f"\n## Signal Usage Frequency")
    for sig, c in sorted(signal_mentions.items(), key=lambda x: -x[1])[:12]:
        out.append(f"  {sig:<25} {c:3} mentions")

    out.append(f"\n## Most Evolved Modules")
    top_modules = sorted(
        [(m, c) for m, c in module_mentions.items() if c >= 5 and len(m) > 10],
        key=lambda x: -x[1]
    )[:12]
    for m, c in top_modules:
        out.append(f"  {m:<35} {c:3} mentions")

    return "\n".join(out)


def kb_seed(top_n: int = 15) -> str:
    """Auto-generate starter KB entries for the highest-dependency modules that have
    zero KB entries."""
    ctx.ensure_ready_sync()
    _track("kb_seed")
    from .health import _compute_iife_caller_counts

    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    sym_files, caller_counts, _ = _compute_iife_caller_counts(src_root, ctx.PROJECT_ROOT)
    if not sym_files:
        return "No symbol files found."

    # Get KB coverage
    try:
        all_kb = ctx.project_engine.list_knowledge()
        kb_names = {e.lower() for e in all_kb} if all_kb else set()
    except Exception as _err:
        logger.debug(f"unnamed-except evolution.py:147: {type(_err).__name__}: {_err}")
        kb_names = set()

    # Find candidates: high caller count + zero KB
    candidates = []
    for sym_name, count in sorted(caller_counts.items(), key=lambda x: -x[1]):
        if sym_name.lower() not in kb_names and count >= 3:
            candidates.append((sym_name, count, sym_files.get(sym_name, "")))
        if len(candidates) >= top_n:
            break

    if not candidates:
        return "All high-dependency modules already have KB entries."

    out = ["# KB Seed Candidates\n"]
    out.append(f"Modules with high caller count but zero KB entries ({len(candidates)} found):\n")

    for name, count, filepath in candidates:
        out.append(f"  {name:<35} {count:3} callers  {filepath}")

    # Try to generate KB entries via synthesis
    if candidates:
        source_snippets = []
        for name, count, filepath in candidates[:8]:
            if filepath and os.path.isfile(filepath):
                try:
                    with open(filepath, encoding="utf-8") as _f:
                        src = _f.read()[:1500]
                    source_snippets.append(f"### {name} ({count} callers)\n```\n{src}\n```")
                except Exception as _err1:
                    logger.debug(f"source_snippets.append: {type(_err1).__name__}: {_err1}")

        if source_snippets:
            prompt = (
                "For each module below, write ONE concise KB entry (2-3 sentences) describing:\n"
                "1. What it does and its architectural role\n"
                "2. Key constraints or invariants that must be maintained\n"
                "Format: `## module_name\\nContent`\n\n"
                + "\n\n".join(source_snippets)
            )
            result = _local_think(prompt, max_tokens=384)
            if result:
                from .synthesis_ollama import compress_for_claude
                result = compress_for_claude(result, max_chars=800, hint="KB entry generation per module")
                out.append(f"\n## Generated Entries\n")
                out.append(result)

    return "\n".join(out)
