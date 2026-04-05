"""HME evolution intelligence — patterns, causal trace, introspection."""
import json
import os
import re
import logging

from server import context as ctx
from server.helpers import get_context_budget, validate_project_path, fmt_score, BUDGET_LIMITS
from symbols import find_callers as _find_callers
from .synthesis import (
    _get_api_key, _claude_think, _local_think, _think_local_or_claude,
    _format_kb_corpus, _THINK_MODEL, _get_max_tokens, _get_effort, _get_tool_budget,
)
from . import _get_compositional_context, _track, _usage_stats

logger = logging.getLogger("HyperMeta-Ecstasy")

@ctx.mcp.tool()
def evolution_patterns() -> str:
    """Analyze metrics/journal.md for meta-patterns across evolution rounds. Identifies confirm/refute rates, subsystem receptivity, recurring themes, and stabilization timelines. Use to understand HOW the system evolves, not just what changed."""
    ctx.ensure_ready_sync()
    _track("evolution_patterns")
    import re
    journal_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "journal.md")
    if not os.path.isfile(journal_path):
        return "No journal found at metrics/journal.md"
    content = open(journal_path, encoding="utf-8").read()

    rounds = re.findall(r'## R(\d+)', content)
    confirmed = re.findall(r'confirmed', content, re.IGNORECASE)
    refuted = re.findall(r'refuted', content, re.IGNORECASE)
    inconclusive = re.findall(r'inconclusive', content, re.IGNORECASE)
    total_outcomes = len(confirmed) + len(refuted) + len(inconclusive)
    subsystem_counts = {}
    for sub in ['conductor', 'crossLayer', 'composers', 'rhythm', 'fx', 'time', 'play', 'writer']:
        count = len(re.findall(sub, content, re.IGNORECASE))
        if count:
            subsystem_counts[sub] = count

    parts = [
        f"## Evolution Patterns ({len(rounds)} rounds analyzed)\n",
        f"**Outcomes:** {len(confirmed)} confirmed, {len(refuted)} refuted, {len(inconclusive)} inconclusive",
        f"**Confirm rate:** {len(confirmed) / max(1, total_outcomes):.0%}\n",
        "**Subsystem activity:**",
    ]
    for sub, count in sorted(subsystem_counts.items(), key=lambda x: -x[1]):
        parts.append(f"  {sub}: {count} mentions")

    journal_tail = content[-4000:]
    user_text = (
        f"Evolution journal excerpt (last ~4000 chars of {len(content)} total):\n{journal_tail}\n\n"
        f"Stats: {len(rounds)} rounds, {len(confirmed)} confirmed, "
        f"{len(refuted)} refuted, {len(inconclusive)} inconclusive\n\n"
        "In 5 bullet points identify:\n"
        "(1) which types of evolutions succeed most often and why,\n"
        "(2) which subsystems are most vs least receptive to change,\n"
        "(3) recurring constants or areas that keep needing adjustment,\n"
        "(4) how many rounds changes typically take to stabilize,\n"
        "(5) any anti-patterns in the evolution approach that should be avoided."
    )
    synthesis = _think_local_or_claude(user_text, _get_api_key())
    if synthesis:
        parts.append(f"\n## Pattern Analysis *(adaptive)*")
        parts.append(synthesis)

    return "\n".join(parts)


@ctx.mcp.tool()
def causal_trace(start: str, max_depth: int = 3) -> str:
    """Trace the causal chain from a constant, module, or signal through controllers, metrics, and regime behavior to its musical effect on the listener. Shows the complete cascade: constant -> controller -> metric -> musical character."""
    ctx.ensure_ready_sync()
    _track("causal_trace")
    if not start.strip():
        return "Error: start cannot be empty. Pass a constant name, module name, or signal dimension."
    parts = [f"# Causal Trace: {start}\n"]

    callers = _find_callers(start, ctx.PROJECT_ROOT)
    callers = [r for r in callers if start not in os.path.basename(r.get('file', ''))]
    caller_files = sorted(set(r['file'].replace(ctx.PROJECT_ROOT + '/', '') for r in callers))
    parts.append(f"## Direct References ({len(caller_files)} files)")
    for f in caller_files[:15]:
        parts.append(f"  {f}")

    subsystems = set()
    for f in caller_files:
        for sub in ['conductor', 'crossLayer', 'composers', 'rhythm', 'fx', 'time', 'play', 'writer']:
            if sub in f:
                subsystems.add(sub)
    if subsystems:
        parts.append(f"\n## Subsystem Reach: {', '.join(sorted(subsystems))}")

    kb_results = ctx.project_engine.search_knowledge(start, top_k=5)
    if kb_results:
        parts.append(f"\n## KB Context ({len(kb_results)} entries)")
        for k in kb_results:
            parts.append(f"  [{k['category']}] {k['title']}: {k['content'][:150]}")

    comp = _get_compositional_context(start)
    if comp:
        parts.append(f"\n## Musical Context")
        parts.append(comp)

    tuning_context = ""
    tuning_path = os.path.join(ctx.PROJECT_ROOT, "doc", "TUNING_MAP.md")
    if os.path.isfile(tuning_path):
        try:
            tuning = open(tuning_path, encoding="utf-8").read()
            tuning_lines = [l for l in tuning.split("\n") if start.lower() in l.lower()]
            if tuning_lines:
                tuning_context = "Tuning map references:\n" + "\n".join(tuning_lines[:10])
        except Exception:
            pass

    # Ground synthesis in actual source code — prevents hallucination
    from .synthesis import _read_module_source
    source_code = _read_module_source(start, max_chars=2000)
    source_block = f"\nSource code (first 2000 chars):\n```\n{source_code}\n```\n" if source_code else ""

    user_text = (
        f"Trace the causal chain for: {start}\n"
        f"Direct callers ({len(caller_files)}): {', '.join(caller_files[:10])}\n"
        f"Subsystems touched: {', '.join(sorted(subsystems))}\n"
        + source_block
        + (f"\n{tuning_context}\n" if tuning_context else "")
        + "\nBased on the ACTUAL source code above, trace the causal chain from this "
        "module to the listener's experience. Format: A -> B -> C -> [musical effect]. "
        "Only reference functions and behaviors visible in the code. Do NOT invent behaviors. "
        "Be specific about musical quality (e.g. 'less rhythmic tension', 'denser texture')."
    )
    api_key = _get_api_key()
    synthesis = None
    if api_key:
        synthesis = _claude_think(user_text, api_key, kb_context=_format_kb_corpus(),
                                   max_tool_calls=_get_tool_budget())
    if not synthesis:
        synthesis = _local_think(user_text, max_tokens=1024)
    if synthesis:
        parts.append(f"\n## Causal Chain *(adaptive)*")
        parts.append(synthesis)

    return "\n".join(parts)


@ctx.mcp.tool()
def hme_introspect() -> str:
    """Self-benchmarking: report HME tool usage patterns for this session. Shows which tools are called most, which mandatory tools are underused, and compositional context from the last pipeline run."""
    _track("hme_introspect")
    parts = ["## HME Session Introspection\n"]

    if _usage_stats:
        sorted_usage = sorted(_usage_stats.items(), key=lambda x: -x[1])
        parts.append("### Tool Usage This Session")
        for tool, count in sorted_usage:
            parts.append(f"  {tool}: {count}")
        parts.append(f"\n**Total tracked calls:** {sum(c for _, c in sorted_usage)}")
        expected = {"before_editing", "what_did_i_forget", "search_knowledge", "search_code", "add_knowledge"}
        unused = expected - set(_usage_stats.keys())
        if unused:
            parts.append(f"**Mandatory but unused:** {', '.join(sorted(unused))}")
    else:
        parts.append("### Tool Usage: no tracked calls yet")

    parts.append("")

    comp = _get_compositional_context("system")
    if comp:
        parts.append("### Last Run Musical Context")
        parts.append(comp)

    journal_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "journal.md")
    if os.path.isfile(journal_path):
        try:
            header_lines = []
            for line in open(journal_path, encoding="utf-8"):
                if header_lines and line.startswith("## R"):
                    break
                header_lines.append(line.rstrip())
                if len(header_lines) > 15:
                    break
            if header_lines:
                parts.append("\n### Latest Journal Entry")
                parts.append("\n".join(header_lines[:15]))
        except Exception:
            pass

    kb_count = 0
    try:
        ctx.ensure_ready_sync()
        all_kb = ctx.project_engine.list_knowledge()
        kb_count = len(all_kb)
    except Exception:
        pass
    idx = {"files": 0, "chunks": 0, "symbols": 0}
    try:
        status = ctx.project_engine.get_status()
        idx["files"] = status.get("total_files", 0)
        idx["chunks"] = status.get("total_chunks", 0)
        sym_status = ctx.project_engine.get_symbol_status()
        idx["symbols"] = sym_status.get("total_symbols", 0) if sym_status.get("indexed") else 0
    except Exception:
        pass
    parts.append(f"\n### System Health")
    parts.append(f"  KB entries: {kb_count}")
    parts.append(f"  Index: {idx['files']} files, {idx['chunks']} chunks, {idx['symbols']} symbols")

    return "\n".join(parts)


@ctx.mcp.tool()
def trace_query(module: str, section: int = -1, limit: int = 20) -> str:
    """Query the last pipeline run's trace.jsonl for runtime behavior of a specific module.
    Shows what a module ACTUALLY DID: when it fired, what values it produced, which
    sections/regimes it was active in. Set section=N to filter to a specific section.
    This is compositional awareness at the runtime level — not what code says, but what happened."""
    ctx.ensure_ready_sync()
    _track("trace_query")
    import subprocess

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found. Run `npm run main` to generate."

    # Use grep to find relevant lines (trace.jsonl can be 25MB+)
    try:
        result = subprocess.run(
            ["grep", "-i", module, trace_path],
            capture_output=True, text=True, timeout=10,
        )
        raw_lines = result.stdout.strip().split("\n") if result.stdout.strip() else []
    except Exception as e:
        return f"Error reading trace: {e}"

    if not raw_lines:
        return f"No trace entries mention '{module}'. It may not emit trace data, or the name might differ from the trace key."

    # Parse JSON lines and extract key fields
    hits = []
    for line in raw_lines:
        try:
            record = json.loads(line)
            beat = record.get("beat", "?")
            sec = record.get("section", "?")
            regime = record.get("currentRegime", record.get("regime", "?"))
            if section >= 0 and sec != section:
                continue
            hits.append({"beat": beat, "section": sec, "regime": regime, "raw": record})
        except Exception:
            continue

    if not hits:
        return f"Found {len(raw_lines)} trace lines mentioning '{module}' but none in section {section}."

    # Summarize
    total = len(hits)
    sections_active = sorted(set(h["section"] for h in hits if h["section"] != "?"))
    regimes_active = {}
    for h in hits:
        r = h["regime"]
        regimes_active[r] = regimes_active.get(r, 0) + 1

    parts = [f"## Trace Query: {module}\n"]
    parts.append(f"**Matches:** {total} beats (of {len(raw_lines)} raw lines)")
    if sections_active:
        parts.append(f"**Active in sections:** {', '.join(str(s) for s in sections_active)}")
    if regimes_active:
        regime_str = ", ".join(f"{k}: {v}" for k, v in sorted(regimes_active.items(), key=lambda x: -x[1]))
        parts.append(f"**Regime distribution:** {regime_str}")

    # Show sample entries (first N)
    parts.append(f"\n### Sample Entries ({min(limit, total)} of {total})")
    for h in hits[:limit]:
        # Find the module-specific value in the record
        module_lower = module.lower()
        relevant = {}
        for k, v in h["raw"].items():
            if module_lower in k.lower() and k not in ("beat", "section", "currentRegime"):
                relevant[k] = v
        if relevant:
            vals = ", ".join(f"{k}={v}" for k, v in list(relevant.items())[:5])
            parts.append(f"  beat {h['beat']} S{h['section']} [{h['regime']}] {vals}")
        else:
            parts.append(f"  beat {h['beat']} S{h['section']} [{h['regime']}]")

    return "\n".join(parts)
