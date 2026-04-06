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
    _format_kb_corpus, _THINK_MODEL, _DEEP_MODEL, _REASONING_MODEL,
    _get_max_tokens, _get_effort, _get_tool_budget,
)
from . import _get_compositional_context, _track

logger = logging.getLogger("HME")

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
        except Exception:
            pass

    # Musical impact — compositional awareness + runtime trace
    comp = _get_compositional_context(module_name)
    if comp:
        parts.append(f"\n## Musical Impact (last run)")
        parts.append(comp)
    # Runtime trace summary — what the module ACTUALLY DID
    _trace_result = None
    try:
        from .evolution import trace_query as _trace_query
        _trace_result = _trace_query(module_name, limit=8)
        # Only include if there's meaningful data (not just "No trace data")
        if "Value Ranges" in _trace_result:
            # Extract just the value ranges section (skip header/samples for brevity)
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
    except Exception:
        pass

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
            except Exception:
                pass
    if blind_spots:
        parts.append(f"\n## Blind Spots ({len(blind_spots)})")
        for bs in blind_spots:
            parts.append(f"  - {bs}")

    # Evolutionary Potential — uncoupled signal dims + live antagonism bridge status
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
        bridges = get_top_bridges(n=6)
        def _is_this(name: str) -> bool:
            return (name == module_name or name == trust_alias
                    or _TRUST_FILE_ALIASES.get(name, name) == module_name)
        my_bridges = [b for b in bridges if _is_this(b["pair_a"]) or _is_this(b["pair_b"])]

        evo_parts = []
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

        if evo_parts:
            parts.append(f"\n## Evolutionary Potential")
            parts.extend(evo_parts)
    except Exception:
        pass

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
        synthesis = _local_think(user_text, max_tokens=2048, model=_REASONING_MODEL)
    if synthesis:
        parts.append(f"\n## Key Constraints *(adaptive)*")
        parts.append(synthesis)

    return "\n".join(parts)


@ctx.mcp.tool()
def think(about: str, context: str = "") -> str:
    """Structured reflection tool. When ANTHROPIC_API_KEY is set, uses Claude with adaptive
    thinking to produce real analysis. Falls back to Ollama (deepseek-r1) with project-grounded
    context injection, then a structured template. For evolution/coupling/HME questions,
    automatically injects antagonist map, dimension gaps, and recent KB patterns."""
    ctx.ensure_ready_sync()
    import re as _re

    prompts = {
        "task_adherence": "Am I still working on what the user asked? Have I drifted into tangential work? What was the original request and am I addressing it?",
        "completeness": "Have I finished everything required? Are there skipped phases (verify, journal, snapshot)? Did I check the pipeline results? Did I update docs?",
        "constraints": "What KB constraints apply to what I'm about to do? Have I called before_editing? Are there boundary rules I might violate?",
        "impact": "What could break from my changes? Have I checked callers? Are there compound effects with other recent changes?",
        "conventions": "Does my code follow project conventions? Line count? Naming? Registration? Architectural boundaries?",
        "recent_changes": "What files changed recently? Are there unintended interactions between the recent changes?",
    }

    # For recent_changes, fetch git context
    if about == "recent_changes" and not context:
        try:
            import subprocess as _sp
            _log = _sp.run(
                ["git", "-C", ctx.PROJECT_ROOT, "log", "--oneline", "--since=6 hours ago",
                 "--name-only", "--diff-filter=AM"],
                capture_output=True, text=True, timeout=5
            )
            if _log.stdout.strip():
                context = f"Recent git activity:\n{_log.stdout.strip()[:800]}"
        except Exception:
            pass

    # Multi-term KB search for richer context than single-query lookup
    kb_hits: list = []
    seen_kb_ids: set = set()
    def _add_kb_hits(query: str, top_k: int = 4) -> None:
        for h in ctx.project_engine.search_knowledge(query, top_k=top_k):
            hid = h.get("id") or h.get("title", "")
            if hid not in seen_kb_ids:
                seen_kb_ids.add(hid)
                kb_hits.append(h)

    _add_kb_hits(about, top_k=5)
    _STOPWORDS = {"about", "which", "would", "should", "could", "their", "there", "these",
                  "those", "where", "while", "using", "every", "other", "after", "before",
                  "since", "think", "tools", "what", "with", "when", "from", "have", "been",
                  "into", "make", "more", "most", "them", "also", "does", "next"}
    key_terms = [w for w in _re.findall(r'\b[a-zA-Z]{5,}\b', about)
                 if w.lower() not in _STOPWORDS]
    for term in key_terms[:6]:
        _add_kb_hits(term, top_k=2)
    kb_block = ""
    if kb_hits:
        lines = [f"  [{k['category']}] {k['title']}: {k['content'][:200]}" for k in kb_hits[:10]]
        kb_block = "Relevant KB patterns and constraints:\n" + "\n".join(lines)

    # Detect meta-HME questions (about improving HME tools themselves, not the music src).
    # Route AWAY from coupling state injection — inject HME doc summary instead.
    _about_lower = about.lower()
    _is_meta_hme = (
        ("hme" in _about_lower and any(t in _about_lower for t in
            ["tool", "tools", "ecstasy", "feature", "usage", "capability", "inducing", "workflow"]))
        or any(t in _about_lower for t in
            ["pipeline_digest", "before_editing", "module_intel", "coupling_intel",
             "what_did_i_forget", "think tool", "tool evolution", "hme evolution"])
    )

    # Auto-inject project state for evolution/coupling questions (NOT for meta-HME tool questions)
    _EVOLUTION_TERMS = {"evolution", "evolve", "coupling", "antagonist", "bridge",
                        "ecstasy", "leverage", "cluster", "organism", "xenolinguistic",
                        "improve", "analysis", "insight", "exciting", "generative", "induce"}
    is_evolution_q = any(t.lower() in _EVOLUTION_TERMS for t in key_terms) and not _is_meta_hme
    injected_state = ""
    if _is_meta_hme and not context:
        # Inject HME tool overview so the model reasons about HME UX, not music src
        try:
            hme_doc = os.path.join(ctx.PROJECT_ROOT, "doc", "HME.md")
            if os.path.isfile(hme_doc):
                with open(hme_doc, encoding="utf-8") as _f:
                    injected_state = "## HME Tool Reference (from doc/HME.md):\n" + _f.read()[:3000]
        except Exception:
            pass
        injected_state += "\n\n## Recent HME Evolution History (from KB):\n"
        hme_kb = [k for k in (ctx.project_engine.list_knowledge_full() or [])
                  if any(t in (k.get("title","") + k.get("content","")).lower()
                         for t in ["hme", "r72", "r73", "r74", "r75", "r76", "r77", "r78", "r79"])]
        for k in hme_kb[:6]:
            injected_state += f"  [{k['category']}] {k['title']}: {k['content'][:200]}\n"
    elif is_evolution_q:
        try:
            from .coupling import antagonist_map as _ant_map, dimension_gap_finder as _dim_gaps
            injected_state = "## Live Project State\n### Antagonist pairs (top creative tensions):\n"
            injected_state += _ant_map()[:1200]
            injected_state += "\n\n### Dimension gaps (underused coupling signals):\n"
            injected_state += _dim_gaps()[:600]
        except Exception:
            pass

    # For dead-channel / signal questions: inject topology + producer source code
    _CHANNEL_TERMS = {"channel", "signal", "dead", "consumer", "producer", "l0", "posted", "consumed", "harvest"}
    is_channel_q = any(t.lower() in _CHANNEL_TERMS for t in key_terms) or any(t.lower() in _CHANNEL_TERMS for t in _re.findall(r'\b\w+\b', about.lower()))
    if is_channel_q and not context:
        try:
            from .coupling import channel_topology as _ch_topo, _scan_l0_topology
            topo = _ch_topo()
            dead_start = topo.find("Dead-end")
            if dead_start == -1:
                dead_start = topo.find("0 consumers")
            channel_block = topo[dead_start:dead_start + 800] if dead_start != -1 else topo[:600]
            injected_state = (injected_state or "") + "\n\n## L0 Dead-End Channels (no consumers — prime harvest targets):\n" + channel_block

            # Inject producer source for mentioned channels so model sees real L0.post field names
            src_root = os.path.join(ctx.PROJECT_ROOT, "src")
            l0_topo = _scan_l0_topology(src_root)
            mentioned_channels = [w for w in _re.findall(r'[a-zA-Z][a-zA-Z-]+', about) if w in l0_topo]
            if mentioned_channels:
                from .synthesis import _read_module_source
                for ch_name in mentioned_channels[:2]:
                    producers = l0_topo[ch_name].get("producers", [])
                    for prod in producers[:1]:
                        src = _read_module_source(prod, max_chars=1500)
                        if src:
                            # Extract just the L0.post call and its surrounding context
                            post_match = _re.search(r'L0\.post\([^)]+\{[^}]+\}', src, _re.DOTALL)
                            if post_match:
                                start = max(0, post_match.start() - 100)
                                snippet = src[start:post_match.end() + 50]
                                injected_state += f"\n\n## Producer source for '{ch_name}' (from {prod}.js):\n```\n{snippet}\n```"
        except Exception:
            pass

    # Directive prompt for free-form questions
    if about in prompts:
        prompt = prompts[about]
    elif _is_meta_hme:
        prompt = (
            f"Question: {about}\n\n"
            f"You are reasoning about HME (HyperMeta Ecstasy) tooling improvements — "
            f"NOT about music source code changes. Focus on: tool UX gaps, missing capabilities, "
            f"workflows that still require manual mental work, and new tool ideas that would make "
            f"the system feel more alive and self-aware. Reference specific tool names, "
            f"the HME doc, and KB patterns above. Be concrete about what exists, what's missing, "
            f"and why the gap matters for the evolution workflow. Max 5 items, no code file paths."
        )
    else:
        prompt = (
            f"Question: {about}\n\n"
            f"You have the KB context and project state injected above. "
            f"Answer DIRECTLY using only the modules, signals, and patterns shown in the KB and project state. "
            f"Do NOT invent hypothetical systems. Do NOT use generic advice. "
            f"For each answer: name the exact FILE (e.g. src/crossLayer/harmony/X.js), "
            f"the exact FUNCTION to modify, the exact SIGNAL FIELD to read, "
            f"and the musical effect in one sentence. "
            f"If something is already done per the KB, skip it. Max 4 items."
        )

    # Claude API path
    api_key = _get_api_key()
    if api_key:
        user_text = f"**Reflection topic:** {about}\n\n**Question/task:** {prompt}"
        if injected_state:
            user_text += f"\n\n{injected_state}"
        if context:
            user_text += f"\n\n**Additional context:** {context}"
        think_effort = {"greedy": "max", "moderate": "high", "conservative": "medium", "minimal": "low"}.get(
            get_context_budget(), "medium"
        )
        answer = _claude_think(user_text, api_key, kb_context=_format_kb_corpus(), effort=think_effort,
                               max_tool_calls=_get_tool_budget(), model=_DEEP_MODEL)
        if answer:
            parts = [f"# Think: {about} *(adaptive/{think_effort}, {_DEEP_MODEL})*\n", answer]
            if kb_hits:
                parts.append("\n**KB references:** " + ", ".join(k["title"] for k in kb_hits[:8]))
            return "\n".join(parts)

    # Ollama path: two-stage synthesis (coder structures, reasoner thinks deeply)
    from .synthesis import _two_stage_think
    raw_context = ""
    if injected_state:
        raw_context += injected_state + "\n\n"
    if context:
        raw_context += f"Additional context: {context}\n\n"
    if kb_block:
        raw_context += kb_block + "\n\n"
    # Clarify channel jargon for local models
    if is_channel_q:
        raw_context += (
            "TERMINOLOGY: 'dead-end channel' means an L0 channel that is posted (produced) but has "
            "ZERO consumers — no module reads it. 'Consuming' a dead-end channel means adding "
            "L0.getLast('channelName', {layer:'both'}) to a new consumer module to read its data.\n\n"
        )
    raw_context += (
        "Polychron modules: motifEcho, entropyRegulator, harmonicIntervalGuard, convergenceDetector, "
        "dynamicRoleSwap, stutterContagion, feedbackOscillator, temporalGravity, crossLayerSilhouette, "
        "texturalMirror, rhythmicPhaseLock, polyrhythmicPhasePredictor, restSynchronizer, "
        "registerCollisionAvoider, spectralComplementarity, grooveTransfer, phaseAwareCadenceWindow. "
        "L0 channels read via: const entry = L0.getLast('channelName', {layer:'both'}); "
        "Each channel posts specific fields — check the producer source code above for exact field names. "
        "Common patterns: emergentRhythm posts {density, complexity, hotspots}, "
        "harmonicFunction posts {fn, chordRoot, keyRoot}, motifEcho posts {delayBeats, interval}."
    )
    local_answer = _two_stage_think(raw_context, prompt)
    if local_answer:
        parts = [f"# Think: {about} *(two-stage)*\n", local_answer]
        if kb_hits:
            parts.append("\n**KB references:** " + ", ".join(k["title"] for k in kb_hits[:8]))
        return "\n".join(parts)

    # Template fallback: show project state so caller can still reason from it
    parts = [f"# Think: {about}\n"]
    parts.append(f"**Prompt:** {prompt}\n")
    if injected_state:
        parts.append(injected_state[:800])
    if context:
        parts.append(f"**Context:** {context}\n")
    if kb_hits:
        parts.append("**Relevant KB:**")
        for k in kb_hits[:6]:
            parts.append(f"  [{k['category']}] {k['title']}: {k['content'][:120]}")
    parts.append("\n**Now reflect and respond before proceeding.**")
    return "\n".join(parts)


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
    # L0 channel consumers: scan the module source for L0.post('channel') and find readers
    from .synthesis import _read_module_source
    import re as _re
    source = _read_module_source(symbol_name, max_chars=10000)
    l0_consumers = []
    if source:
        posted_channels = _re.findall(r"L0\.post\(['\"]([^'\"]+)['\"]", source)
        if posted_channels:
            # Scan src/ for L0 consumers of these channels
            read_pats = [_re.compile(r"L0\." + method + r"\(\s*['\"]" + ch + r"['\"]")
                         for ch in set(posted_channels)
                         for method in ("getLast", "query", "findClosest", "count", "getBounds")]
            src_root = os.path.join(ctx.PROJECT_ROOT, "src")
            for dp, _, fnames in os.walk(src_root):
                for fn in fnames:
                    if not fn.endswith(".js"):
                        continue
                    fp = os.path.join(dp, fn)
                    try:
                        with open(fp, encoding="utf-8", errors="ignore") as _f:
                            content = _f.read()
                    except Exception:
                        continue
                    rel = fp.replace(ctx.PROJECT_ROOT + "/", "")
                    for pat in read_pats:
                        m_obj = pat.search(content)
                        if m_obj:
                            ch_name = _re.search(r"['\"]([^'\"]+)['\"]", m_obj.group()).group(1)
                            l0_consumers.append(f"  {rel} (via L0 '{ch_name}')")
                            break
    if l0_consumers:
        parts.append(f"\n## L0 Channel Consumers ({len(l0_consumers)} sites)")
        for lc in l0_consumers:
            parts.append(lc)
        total += len(l0_consumers)

    parts.append(f"\nTotal blast radius: {total} sites across {len(layers)} depth levels"
                 + (f" + {len(l0_consumers)} L0 consumers" if l0_consumers else ""))
    all_files = set()
    for _, results in layers:
        for r in results:
            f = r.strip().split(":")[0]
            all_files.add(f)
    for lc in l0_consumers:
        f = lc.strip().split(":")[0].split(" (via")[0]
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
                     if api_key else _local_think(user_text, max_tokens=2048, model=_REASONING_MODEL))
        if synthesis:
            parts.append(f"\n## Change Risk *(adaptive)*")
            parts.append(synthesis)

    return "\n".join(parts)


@ctx.mcp.tool()
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
