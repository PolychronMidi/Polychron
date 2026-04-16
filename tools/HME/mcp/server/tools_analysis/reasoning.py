"""HME reasoning tools — module biography (module_story, module_intel, build_evolutionary_potential)."""
import os
import logging

from server import context as ctx
from server.helpers import get_context_budget, validate_project_path, fmt_score, fmt_sim_score, BUDGET_LIMITS
from symbols import collect_all_symbols, find_callers as _find_callers
from structure import file_summary as _file_summary
from analysis import find_similar_code as _find_similar
from .synthesis import _local_think, _REASONING_MODEL, _THINK_SYSTEM
from . import _get_compositional_context, _track

logger = logging.getLogger("HME")


def build_evolutionary_potential(module_name: str) -> list[str]:
    """Build the Evolutionary Potential section for a module.

    Returns list of formatted lines showing: uncoupled signal dims,
    phase coupling status, and live antagonism bridge opportunities.
    Shared by module_story() and before_editing()."""
    try:
        from .coupling import _scan_coupling_state, get_top_bridges, _TRUST_FILE_ALIASES, _FILE_TRUST_ALIASES
        src_root = os.path.join(ctx.PROJECT_ROOT, "src")
        coupling_state = _scan_coupling_state(src_root)
        m_info = coupling_state.get(module_name, {})
        _ALL_MELODIC = ["contourShape", "registerMigrationDir", "tessituraLoad", "thematicDensity",
                        "counterpoint", "intervalFreshness", "ascendRatio", "freshnessEma"]
        _ALL_RHYTHM  = ["densitySurprise", "hotspots", "complexityEma", "biasStrength", "complexity", "density"]
        used_m = set(m_info.get("melodic_dims", []))
        used_r = set(m_info.get("rhythm_dims", []))
        unused_m = [d for d in _ALL_MELODIC if d not in used_m]
        unused_r = [f for f in _ALL_RHYTHM  if f not in used_r]

        trust_alias = _FILE_TRUST_ALIASES.get(module_name, module_name)
        # Use -0.20 threshold to surface weaker virgin pairs (e.g. r=-0.211) in module-specific view
        bridges = get_top_bridges(n=6, threshold=-0.20)
        def _is_this(name: str) -> bool:
            return (name == module_name or name == trust_alias
                    or _TRUST_FILE_ALIASES.get(name, name) == module_name)
        my_bridges = [b for b in bridges if _is_this(b["pair_a"]) or _is_this(b["pair_b"])]

        evo_parts: list[str] = []
        if not m_info.get("melodic"):
            evo_parts.append(f"  Not melodically coupled — top dims: {', '.join(_ALL_MELODIC[:4])}...")
        elif unused_m:
            evo_parts.append(f"  Unused melodic dims: {', '.join(unused_m[:5])}")
        if not m_info.get("rhythm"):
            evo_parts.append(f"  Not rhythmically coupled — top fields: {', '.join(_ALL_RHYTHM[:4])}...")
        elif unused_r:
            evo_parts.append(f"  Unused rhythm fields: {', '.join(unused_r[:4])}")
        if not m_info.get("phase"):
            evo_parts.append(f"  Not phase-coupled — add rhythmicPhaseLock.getMode() for lock/drift/repel awareness")

        for b in my_bridges[:2]:
            partner_raw = b["pair_b"] if _is_this(b["pair_a"]) else b["pair_a"]
            partner = _TRUST_FILE_ALIASES.get(partner_raw, partner_raw)
            if b["already_bridged"]:
                evo_parts.append(f"  BRIDGED r={b['r']:+.3f} vs {partner} (via {', '.join(b['already_bridged'])})")
            else:
                evo_parts.append(f"  BRIDGE OPPORTUNITY r={b['r']:+.3f} vs {partner}")
                evo_parts.append(f"    bridge field: `{b['field']}`")
                evo_parts.append(f"    {b['eff_a']} | opposite: {b['eff_b']}")
                evo_parts.append(f"    musical logic: {b['why']}")
        return evo_parts
    except Exception as _err:
        logger.debug(f"unnamed-except reasoning.py:66: {type(_err).__name__}: {_err}")
        return []


def module_story(module_name: str) -> str:
    """Living biography of a module. Internal — call via module_intel(target, mode='story')."""
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
    if matching and len(matching) > 1:
        # Prefer the file whose basename matches the module name (definition over call site)
        name_matched = [s for s in matching if os.path.basename(s["file"]).replace(".js", "") == module_name]
        if name_matched:
            matching = name_matched
    if not matching:
        # File search first: a file named after the module is almost certainly the definition
        import glob as _glob
        candidates = _glob.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", f"{module_name}.js"), recursive=True)
        if candidates:
            matching = [{"name": module_name, "kind": "module", "file": candidates[0], "line": 1, "signature": ""}]
    if not matching:
        # Prefix match: find symbols whose name starts with the module name (inner functions)
        prefix_matches = [s for s in syms if s["name"].startswith(module_name) and s["kind"] in ("function", "method")]
        if prefix_matches:
            matching = [{"name": module_name, "kind": "module", "file": prefix_matches[0]["file"], "line": 1, "signature": ""}]
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
    callers = [r for r in callers
               if module_name not in os.path.basename(r.get('file', ''))
               and not r.get('file', '').endswith('.md')]
    caller_files = sorted(set(r['file'].replace(ctx.PROJECT_ROOT + '/', '') for r in callers))
    caller_limit = limits["callers"]
    parts.append(f"## Dependents ({len(caller_files)} files)")
    for f in caller_files[:caller_limit]:
        parts.append(f"  {f}")
    if len(caller_files) > caller_limit:
        parts.append(f"  ... and {len(caller_files) - caller_limit} more")
    # L0 signal I/O — channels this module reads and posts
    if matching:
        try:
            import re as _re
            with open(matching[0]["file"], encoding="utf-8", errors="ignore") as _mf:
                _src = _mf.read()
            _posts = sorted(set(_re.findall(r"L0\.post\('([^']+)'", _src)))
            # Also catch variable-based channel names: const CHANNEL = 'name'; L0.post(CHANNEL, ...)
            _chan_vars = dict(_re.findall(r"const\s+(\w+)\s*=\s*'([^']+)'", _src))
            for _var, _ch in _chan_vars.items():
                if _re.search(r"L0\.post\(" + _re.escape(_var) + r"\b", _src):
                    _posts = sorted(set(_posts + [_ch]))
            _reads = sorted(set(_re.findall(r"L0\.getLast\('([^']+)'", _src)))
            if _posts or _reads:
                parts.append(f"\n## L0 Signal I/O")
                if _posts:
                    parts.append(f"  POSTS: {', '.join(_posts)}")
                if _reads:
                    parts.append(f"  READS: {', '.join(_reads)}")
        except Exception as _err1:
            logger.debug(f"parts.append: {type(_err1).__name__}: {_err1}")

    # Musical impact — compositional awareness + runtime trace
    comp = _get_compositional_context(module_name)
    if comp:
        parts.append(f"\n## Musical Impact (last run)")
        parts.append(comp)
    # Runtime trace summary — what the module ACTUALLY DID
    # Gate behind greedy budget: trace_query calls synthesis model (300-600s on local model).
    # On moderate/conservative, skip entirely — Musical Impact section above covers basics.
    _trace_result = None
    if budget == "greedy":
        try:
            from .evolution import trace_query as _trace_query
            _trace_result = _trace_query(module_name, limit=8)
            # Only include if there's meaningful data (not just "No trace data")
            if _trace_result and "Value Ranges" in _trace_result:
                trace_lines = _trace_result.split("\n")
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
        except Exception as _err2:
            logger.debug(f"parts.extend: {type(_err2).__name__}: {_err2}")

    # Runtime interactions (top cooperative/competitive modules)
    try:
        from .evolution import interaction_map as _imap
        imap_result = _imap(module_name)
        if imap_result and "No trace" not in imap_result and "Insufficient" not in imap_result:
            imap_lines = imap_result.split("\n")
            parts.append(f"\n## Interactions (last run)")
            for line in imap_lines[1:9]:  # skip header, show top 8
                if line.strip():
                    parts.append(line)
    except Exception as _err3:
        logger.debug(f"parts.append: {type(_err3).__name__}: {_err3}")

    # Semantic neighbors
    sim_limit = limits["similar"]
    if matching and sim_limit > 0:
        try:
            with open(matching[0]["file"], encoding="utf-8", errors="ignore") as _f:
                content = _f.read()[:500]
            similar = _find_similar(content, ctx.project_engine, top_k=sim_limit + 5)
            if similar:
                source_file = matching[0]["file"]
                # Filter to src/ files only — tools/HME Python files are false positives
                # Dedup by source path (embedding index returns multiple chunks per file)
                seen_sources: set = set()
                filtered = []
                for r in similar:
                    src = r.get("source") or ""
                    if src == source_file or "/src/" not in src or src in seen_sources:
                        continue
                    seen_sources.add(src)
                    filtered.append(r)
                    if len(filtered) >= sim_limit:
                        break
                if filtered:
                    parts.append(f"\n## Similar Modules")
                    for r in filtered:
                        parts.append(f"  {r['source'].replace(ctx.PROJECT_ROOT + '/', '')} ({fmt_sim_score(r['score'])})")
        except Exception as _err4:
            logger.debug(f"parts.append: {type(_err4).__name__}: {_err4}")

    # Blind spots — what HME can't see about this module
    blind_spots = []
    if len(caller_files) >= 5 and not relevant:
        blind_spots.append(f"KNOWLEDGE GAP: {len(caller_files)} dependents but zero KB entries — this module needs documented constraints")
    if not relevant and matching:
        blind_spots.append("No calibration anchors, decisions, or known bugs in KB for this module")
    # Re-use cached trace result rather than calling trace_query a second time
    if _trace_result is not None and "No trace data" in _trace_result:
        blind_spots.append("NO RUNTIME DATA: this module doesn't emit to trace.jsonl — runtime behavior is invisible")
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
            except Exception as _err5:
                logger.debug(f"blind_spots.append: {type(_err5).__name__}: {_err5}")
    if blind_spots:
        parts.append(f"\n## Blind Spots ({len(blind_spots)})")
        for bs in blind_spots:
            parts.append(f"  - {bs}")

    # Evolutionary Potential — only show when actionable (mirrors before_editing gate)
    evo_lines = build_evolutionary_potential(module_name)
    if any("OPPORTUNITY" in l or "Unused" in l or "Not " in l for l in evo_lines):
        parts.append(f"\n## Evolutionary Potential")
        parts.extend(evo_lines)


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
        f"Dependents ({len(caller_files)}): {callers_summary}\n"
        f"KB evolution history:\n{kb_summary}\n"
        + source_block
        + f"\nRules:\n"
        "- If this module has 0 dependents and no KB history, respond: 'No constraints — leaf module.'\n"
        "- Otherwise, in 1-3 bullet points: " + subsystem_prompt + "\n"
        "- Only reference behaviors visible in the code above. Do NOT speculate.\n"
    )
    synthesis = _local_think(user_text, max_tokens=800, model=_REASONING_MODEL,
                             system=_THINK_SYSTEM)
    if synthesis:
        from .synthesis.synthesis_inference import compress_for_claude
        synthesis = compress_for_claude(synthesis, max_chars=800, hint=f"key constraints for {module_name}")
        parts.append(f"\n## Key Constraints *(adaptive)*")
        parts.append(synthesis)
    else:
        logger.warning(f"module_story({module_name!r}): adaptive synthesis unavailable")

    return "\n".join(parts)


def module_intel(target: str, mode: str = "story") -> str:
    """Unified module intelligence. Replaces module_story + impact_analysis in one call.
    mode='story' (default): full living biography — definition, KB evolution history, callers,
    runtime behavior, interactions, semantic neighbors, blind spots, adaptive synthesis.
    Output scales with context budget (greedy when plentiful, minimal when tight).
    mode='impact': blast radius — who calls it, what it calls, KB constraints, definition site.
    Lighter than story; use when you just need caller graph + constraint check before a quick edit.
    mode='both': story first, then impact analysis. Use before a high-stakes edit to a
    well-connected module — you get the full biography AND the caller blast radius."""
    ctx.ensure_ready_sync()
    _track("module_intel")
    if not target.strip():
        return "Error: target cannot be empty."
    if mode == "story":
        return module_story(target)
    if mode == "impact":
        from .health import impact_analysis as _impact
        return _impact(target)
    if mode == "both":
        story = module_story(target)
        from .health import impact_analysis as _impact
        impact = _impact(target)
        return f"{story}\n\n---\n\n## Impact Analysis\n{impact}"
    return f"Unknown mode '{mode}'. Use 'story', 'impact', or 'both'."
