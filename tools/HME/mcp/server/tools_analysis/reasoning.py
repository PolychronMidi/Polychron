"""HME reasoning tools — module biography, reflection, blast radius."""
import os
import logging

from server import context as ctx
from server.helpers import get_context_budget, validate_project_path, fmt_score, fmt_sim_score, BUDGET_LIMITS
from symbols import collect_all_symbols, find_callers as _find_callers
from structure import file_summary as _file_summary
from analysis import find_similar_code as _find_similar
from .synthesis import (
    _get_api_key, _claude_think, _local_think, _think_local_or_claude,
    _format_kb_corpus, _THINK_MODEL, _DEEP_MODEL, _get_max_tokens, _get_effort, _get_tool_budget,
)
from . import _get_compositional_context, _track

logger = logging.getLogger("HME")

@ctx.mcp.tool()
def module_story(module_name: str) -> str:
    """Tell the story of a module: definition, evolution history from KB, callers, conventions, and current health. A living biography. Output is automatically scaled based on remaining context window — greedy when context is plentiful, minimal when tight."""
    ctx.ensure_ready_sync()
    _track("module_story")
    if not module_name.strip():
        return "Error: module_name cannot be empty."
    budget = get_context_budget()
    limits = BUDGET_LIMITS[budget]
    parts = [f"# Module Story: {module_name} (context: {budget})\n"]
    # Definition — try exact symbol match, then prefix match, then file search
    syms = collect_all_symbols(ctx.PROJECT_ROOT)
    matching = [s for s in syms if s["name"] == module_name]
    if not matching:
        # Prefix match: find symbols whose name starts with the module name (inner functions)
        prefix_matches = [s for s in syms if s["name"].startswith(module_name) and s["kind"] in ("function", "method")]
        if prefix_matches:
            # Use the file from the first match as the definition location
            matching = [{"name": module_name, "kind": "module", "file": prefix_matches[0]["file"], "line": 1, "signature": ""}]
    if not matching:
        # File search: look for a file named after the module
        import glob as _glob
        candidates = _glob.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", f"{module_name}.js"), recursive=True)
        if candidates:
            matching = [{"name": module_name, "kind": "module", "file": candidates[0], "line": 1, "signature": ""}]
    if not matching:
        return f"Module '{module_name}' not found. No matching symbol, prefix, or file in src/."
    if matching:
        s = matching[0]
        parts.append(f"## Definition")
        parts.append(f"  {s['file'].replace(ctx.PROJECT_ROOT + '/', '')}:{s['line']} [{s['kind']}]")
        # File summary
        result = _file_summary(s["file"])
        if not result.get("error") and result.get("symbols"):
            sym_limit = limits["symbols"]
            parts.append(f"  {result['lines']} lines, {len(result['symbols'])} symbols")
            for sym in result["symbols"][:sym_limit]:
                sig = f" {sym['signature']}" if sym.get('signature') else ""
                parts.append(f"    L{sym['line']}: {sym['name']}{sig}")
            if len(result["symbols"]) > sym_limit:
                parts.append(f"    ... and {len(result['symbols']) - sym_limit} more")
        parts.append("")
    # Evolution history from KB — filtered for actual relevance to this module
    from . import _filter_kb_relevance
    kb_limit = limits["kb_entries"] * 2
    kb_results = ctx.project_engine.search_knowledge(module_name, top_k=kb_limit)
    glob_results = ctx.global_engine.search_knowledge(module_name, top_k=3) if ctx.global_engine else []
    all_kb = kb_results + [dict(r, title=f"[global] {r['title']}") for r in glob_results]
    relevant = _filter_kb_relevance(all_kb, module_name)
    if relevant:
        parts.append(f"## Evolution History ({len(relevant)} KB entries)")
        for k in relevant:
            parts.append(f"  **[{k['category']}] {k['title']}**")
            kb_body = k['content'][:limits['kb_content']]
            parts.append(f"  {kb_body}" + ("..." if len(k['content']) > limits['kb_content'] else ""))
            parts.append("")
    else:
        parts.append("## Evolution History: no KB entries mention this module\n")
    # Callers
    callers = _find_callers(module_name, ctx.PROJECT_ROOT)
    callers = [r for r in callers if module_name not in os.path.basename(r.get('file', ''))]
    caller_files = sorted(set(r['file'].replace(ctx.PROJECT_ROOT + '/', '') for r in callers))
    caller_limit = limits["callers"]
    parts.append(f"## Dependents ({len(caller_files)} files)")
    for f in caller_files[:caller_limit]:
        parts.append(f"  {f}")
    if len(caller_files) > caller_limit:
        parts.append(f"  ... and {len(caller_files) - caller_limit} more")
    # Musical impact — compositional awareness + runtime trace
    comp = _get_compositional_context(module_name)
    if comp:
        parts.append(f"\n## Musical Impact (last run)")
        parts.append(comp)
    # Runtime trace summary — what the module ACTUALLY DID
    try:
        from .evolution import trace_query as _trace_query
        trace_result = _trace_query(module_name, limit=8)
        # Only include if there's meaningful data (not just "No trace data")
        if "Value Ranges" in trace_result:
            # Extract just the value ranges section (skip header/samples for brevity)
            trace_lines = trace_result.split("\n")
            runtime_lines = []
            in_ranges = False
            for tl in trace_lines:
                if "Beats with data" in tl or "Active in sections" in tl or "Regime distribution" in tl:
                    runtime_lines.append(tl)
                elif "Value Ranges" in tl:
                    in_ranges = True
                    runtime_lines.append(tl)
                elif in_ranges and tl.startswith("  "):
                    runtime_lines.append(tl)
                elif in_ranges and not tl.startswith("  "):
                    in_ranges = False
            if runtime_lines:
                parts.append(f"\n## Runtime Behavior (last run)")
                parts.extend(runtime_lines)
    except Exception:
        pass

    # Semantic neighbors
    sim_limit = limits["similar"]
    if matching and sim_limit > 0:
        try:
            with open(matching[0]["file"], encoding="utf-8", errors="ignore") as _f:
                content = _f.read()[:500]
            similar = _find_similar(content, ctx.project_engine, top_k=sim_limit + 3)
            if similar:
                source_file = matching[0]["file"]
                filtered = [r for r in similar if r.get("source") != source_file][:sim_limit]
                if filtered:
                    parts.append(f"\n## Similar Modules")
                    for r in filtered:
                        parts.append(f"  {r['source'].replace(ctx.PROJECT_ROOT + '/', '')} ({fmt_sim_score(r['score'])})")
        except Exception:
            pass

    # Blind spots — what HME can't see about this module
    blind_spots = []
    if len(caller_files) >= 5 and not relevant:
        blind_spots.append(f"KNOWLEDGE GAP: {len(caller_files)} dependents but zero KB entries — this module needs documented constraints")
    if not relevant and matching:
        blind_spots.append("No calibration anchors, decisions, or known bugs in KB for this module")
    # Check if module has runtime trace data
    try:
        from .evolution import trace_query as _tq
        _trace_test = _tq(module_name, limit=1)
        if "No trace data" in _trace_test:
            blind_spots.append("NO RUNTIME DATA: this module doesn't emit to trace.jsonl — runtime behavior is invisible")
    except Exception:
        pass
    # Check if module is mentioned in key docs
    for doc_name in ["TUNING_MAP.md", "ARCHITECTURE.md"]:
        doc_path = os.path.join(ctx.PROJECT_ROOT, "doc", doc_name)
        if os.path.isfile(doc_path):
            try:
                with open(doc_path, encoding="utf-8") as _f:
                    _doc_text = _f.read().lower()
                if module_name.lower() not in _doc_text:
                    if len(caller_files) >= 5:
                        blind_spots.append(f"NOT IN {doc_name}: high-dependency module undocumented in key architecture docs")
            except Exception:
                pass
    if blind_spots:
        parts.append(f"\n## Blind Spots ({len(blind_spots)})")
        for bs in blind_spots:
            parts.append(f"  - {bs}")

    # Adaptive synthesis: top 3 things to know before editing
    callers_summary = ", ".join(caller_files[:8]) if caller_files else "none"
    kb_summary = "\n".join(
        f"  [{k['category']}] {k['title']}: {k['content'][:100]}"
        for k in relevant
    ) if relevant else "none"
    # Ground in actual source code
    from .synthesis import _read_module_source
    source_code = _read_module_source(module_name, max_chars=1500)
    source_block = f"\nSource code (first 1500 chars):\n```\n{source_code}\n```\n" if source_code else ""
    # Subsystem-aware synthesis prompt — ask questions relevant to what this module DOES
    file_path = matching[0]["file"] if matching else ""
    subsystem_prompt = ""
    if "/trust/" in file_path or "Trust" in module_name:
        subsystem_prompt = "How does this module affect which systems gain or lose influence? What would the listener hear if trust weights shift?"
    elif "/rhythm/" in file_path or "/convergence" in file_path.lower():
        subsystem_prompt = "How does this affect the rhythmic dialogue between layers? What happens to convergence/divergence patterns?"
    elif "/harmony/" in file_path:
        subsystem_prompt = "How does this affect harmonic choices? What would the listener hear — key changes, dissonance, resolution?"
    elif "/form/" in file_path or "section" in module_name.lower():
        subsystem_prompt = "How does this shape the large-scale musical form? Which sections would sound different? Would the arc change?"
    elif "/signal/" in file_path or "/profiling/" in file_path:
        subsystem_prompt = "How does this affect signal processing and regime classification? What regime shifts would change?"
    elif "/meta/" in file_path:
        subsystem_prompt = "How does this self-calibration affect the system's overall behavior? What would drift if this controller breaks?"
    elif "/dynamics/" in file_path or "/stutter/" in file_path:
        subsystem_prompt = "How does this affect musical expressiveness — velocity, articulation, micro-timing? What would feel different?"
    else:
        subsystem_prompt = "What are the hidden invariants and caller contracts?"
    user_text = (
        f"Module: {module_name}\n"
        f"Dependents: {callers_summary}\n"
        f"KB evolution history:\n{kb_summary}\n"
        + source_block
        + f"\nBased on the actual code above, in 3 bullet points: {subsystem_prompt} "
        "Only reference behaviors visible in the code. Be specific about musical effects."
    )
    api_key = _get_api_key()
    synthesis = None
    if api_key:
        synthesis = _claude_think(user_text, api_key, kb_context=_format_kb_corpus(),
                                   max_tool_calls=_get_tool_budget())
    if not synthesis:
        synthesis = _local_think(user_text, max_tokens=1024)
    if synthesis:
        parts.append(f"\n## Key Constraints *(adaptive)*")
        parts.append(synthesis)

    return "\n".join(parts)


@ctx.mcp.tool()
def think(about: str, context: str = "") -> str:
    """Structured reflection tool. When ANTHROPIC_API_KEY is set, uses Claude with adaptive thinking to produce real analysis. Falls back to a structured reflection template otherwise."""
    ctx.ensure_ready_sync()
    prompts = {
        "task_adherence": "Am I still working on what the user asked? Have I drifted into tangential work? What was the original request and am I addressing it?",
        "completeness": "Have I finished everything required? Are there skipped phases (verify, journal, snapshot)? Did I check the pipeline results? Did I update docs?",
        "constraints": "What KB constraints apply to what I'm about to do? Have I called before_editing? Are there boundary rules I might violate?",
        "impact": "What could break from my changes? Have I checked callers? Are there compound effects with other recent changes?",
        "conventions": "Does my code follow project conventions? Line count? Naming? Registration? Architectural boundaries?",
        "recent_changes": "What files changed recently? Are there unintended interactions between the recent changes?",
    }
    prompt = prompts.get(about, f"Reflect on: {about}")

    # For recent_changes, fetch git context and inject as additional context
    if about == "recent_changes" and not context:
        try:
            import subprocess as _sp
            _log = _sp.run(
                ["git", "-C", ctx.PROJECT_ROOT, "log", "--oneline", "--since=6 hours ago", "--name-only", "--diff-filter=AM"],
                capture_output=True, text=True, timeout=5
            )
            if _log.stdout.strip():
                context = f"Recent git activity:\n{_log.stdout.strip()[:800]}"
        except Exception:
            pass

    # Gather KB context regardless of path
    kb_hits = ctx.project_engine.search_knowledge(about, top_k=5)
    kb_block = ""
    if kb_hits:
        lines = [f"  [{k['category']}] {k['title']}: {k['content'][:200]}" for k in kb_hits]
        kb_block = "Relevant KB constraints:\n" + "\n".join(lines)

    api_key = _get_api_key()
    if api_key:
        user_text = f"**Reflection topic:** {about}\n\n**Question:** {prompt}"
        if context:
            user_text += f"\n\n**Additional context:** {context}"
        # think is an explicit reasoning call — full 4-step effort scaling
        think_effort = {"greedy": "max", "moderate": "high", "conservative": "medium", "minimal": "low"}.get(
            get_context_budget(), "medium"
        )
        answer = _claude_think(user_text, api_key, kb_context=_format_kb_corpus(), effort=think_effort,
                               max_tool_calls=_get_tool_budget(), model=_DEEP_MODEL)
        if answer:
            parts = [f"# Think: {about} *(adaptive/{think_effort}, {_DEEP_MODEL})*\n", answer]
            if kb_hits:
                parts.append("\n**KB references:** " + ", ".join(k["title"] for k in kb_hits))
            return "\n".join(parts)

    # Ollama fallback before template
    user_text = f"**Reflection topic:** {about}\n\n**Question:** {prompt}"
    if context:
        user_text += f"\n\n**Additional context:** {context}"
    if kb_block:
        user_text += f"\n\n{kb_block}"
    local_answer = _local_think(user_text, max_tokens=1024)
    if local_answer:
        parts = [f"# Think: {about} *(local)*\n", local_answer]
        if kb_hits:
            parts.append("\n**KB references:** " + ", ".join(k["title"] for k in kb_hits))
        return "\n".join(parts)

    # Template fallback (no models available)
    parts = [f"# Think: {about}\n"]
    parts.append(f"**Prompt:** {prompt}\n")
    if context:
        parts.append(f"**Context:** {context}\n")
    if kb_hits:
        parts.append("**Relevant KB:**")
        for k in kb_hits:
            parts.append(f"  [{k['category']}] {k['title']}: {k['content'][:100]}...")
    parts.append("\n**Now reflect and respond before proceeding.**")
    return "\n".join(parts)


@ctx.mcp.tool()
def blast_radius(symbol_name: str, max_depth: int = 3) -> str:
    """Trace the full transitive dependency chain of a symbol: who calls it, who calls those callers, etc. Deeper than impact_analysis."""
    ctx.ensure_ready_sync()
    if not symbol_name.strip():
        return "Error: symbol_name cannot be empty."
    visited = set()
    layers = []
    current = [symbol_name]
    for depth in range(max_depth):
        next_layer = []
        layer_results = []
        for sym in current:
            if sym in visited:
                continue
            visited.add(sym)
            callers = _find_callers(sym, ctx.PROJECT_ROOT)
            for r in callers:
                rel = r["file"].replace(ctx.PROJECT_ROOT + "/", "")
                if not rel.startswith("src/"):
                    continue
                caller_file = os.path.basename(r["file"]).replace(".js", "").replace(".ts", "")
                if caller_file not in visited and caller_file != sym:
                    next_layer.append(caller_file)
                    layer_results.append(f"  {r['file'].replace(ctx.PROJECT_ROOT + '/', '')}:{r['line']} ({sym})")
        if layer_results:
            layers.append((depth + 1, layer_results))
        current = list(set(next_layer))
        if not current:
            break
    if not layers:
        return f"No callers found for '{symbol_name}'. Blast radius = 0."
    parts = [f"# Blast Radius: {symbol_name}\n"]
    total = 0
    for depth, results in layers:
        total += len(results)
        parts.append(f"## Depth {depth} ({len(results)} sites)")
        for r in results[:15]:
            parts.append(r)
        if len(results) > 15:
            parts.append(f"  ... and {len(results) - 15} more")
        parts.append("")
    # KB constraints
    kb_hits = ctx.project_engine.search_knowledge(symbol_name, top_k=2)
    if kb_hits:
        parts.append("## KB Constraints")
        for k in kb_hits:
            parts.append(f"  [{k['category']}] {k['title']}")
    parts.append(f"\nTotal blast radius: {total} sites across {len(layers)} depth levels")
    all_files = set()
    for _, results in layers:
        for r in results:
            f = r.strip().split(":")[0]
            all_files.add(f)
    parts.append(f"Files affected: {len(all_files)}")

    if total > 0:
        depth_summary = "; ".join(f"depth {d}: {len(r)} sites" for d, r in layers)
        user_text = (
            f"Symbol changed: {symbol_name}\n"
            f"Blast radius: {total} call sites in {len(all_files)} files ({depth_summary})\n\n"
            "In 3 points: (1) which callers at depth 1 are highest-risk to break, "
            "(2) what integration tests or validation steps are most important, "
            "(3) any cascade effects to watch for in deeper layers."
        )
        api_key = _get_api_key()
        synthesis = (_claude_think(user_text, api_key, kb_context=_format_kb_corpus())
                     if api_key else _local_think(user_text))
        if synthesis:
            parts.append(f"\n## Change Risk *(adaptive)*")
            parts.append(synthesis)

    return "\n".join(parts)
