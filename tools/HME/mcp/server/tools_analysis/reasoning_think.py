"""HME reasoning — think tool and blast_radius analysis."""
import os
import logging

from server import context as ctx
from symbols import find_callers as _find_callers
from .synthesis import (
    _local_think, _REASONING_MODEL, _THINK_SYSTEM,
    _two_stage_think, _parallel_two_stage_think,
    store_think_history, get_think_history_context,
    _read_module_source,
)
from .synthesis_ollama import _cascade_synthesis, _assess_complexity, _fuzzy_find_modules

logger = logging.getLogger("HME")


def _ground_file_paths(text: str) -> str:
    """Verify file paths referenced in model output. Annotate hallucinated paths."""
    import re as _re
    _path_re = _re.compile(r'(?:FILE:\s*|(?:^|\s))(src/[a-zA-Z0-9_./-]+\.(?:js|ts|py))', _re.MULTILINE)
    seen: dict = {}
    for m in _path_re.finditer(text):
        path = m.group(1)
        if path not in seen:
            full = os.path.join(ctx.PROJECT_ROOT, path)
            seen[path] = os.path.isfile(full)
    hallucinated = [p for p, exists in seen.items() if not exists]
    if hallucinated:
        text += "\n\n⚠ *Grounding check: the following paths were referenced but do not exist:*"
        for p in hallucinated:
            text += f"\n  - `{p}` (hallucinated by local model)"
    return text


def think(about: str, context: str = "") -> str:
    """Structured reflection tool. Uses Ollama hybrid synthesis (qwen3-coder extract +
    qwen3:30b-a3b reason) with project-grounded context injection. Routes by question type:
    meta-HME tool questions → single-stage with HME doc+KB injection; evolution/coupling →
    parallel two-stage with antagonist map + dimension gaps; channel questions → topology +
    producer source injection. Shortcut keys: task_adherence, completeness, constraints,
    impact, conventions, recent_changes."""
    ctx.ensure_ready_sync()
    if not about or not about.strip():
        return "Error: 'about' cannot be empty. Pass a question, analysis topic, or shortcut key (task_adherence, completeness, constraints, impact, conventions, recent_changes)."
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
        lines = [f"  [{k['category']}] {k['title']}: {k['content'][:300]}" for k in kb_hits[:10]]
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

    # Detect pipeline/ML/perceptual infrastructure questions — about snapshot-run.js,
    # train-verdict-predictor.js, perceptual-analysis.js, CLAP, EnCodec, verdict model.
    # These need no coupling state injection (not about src/ module pairing) and no
    # HME tool doc either — they're about the pipeline scripts themselves.
    _is_pipeline_infra = any(t in _about_lower for t in [
        "verdict predictor", "verdict model", "clap", "encodec", "cb0", "cb1",
        "perceptual", "snapshot", "run-history", "train-verdict", "ml pipeline",
        "logistic", "perceptual-analysis", "snapshot-run",
    ])

    # Auto-inject project state for evolution/coupling questions (NOT for meta-HME or pipeline questions)
    _EVOLUTION_TERMS = {"evolution", "evolve", "coupling", "antagonist", "bridge",
                        "ecstasy", "leverage", "cluster", "organism", "xenolinguistic",
                        "improve", "analysis", "insight", "exciting", "generative", "induce"}
    is_evolution_q = any(t.lower() in _EVOLUTION_TERMS for t in key_terms) and not _is_meta_hme and not _is_pipeline_infra
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
        _hme_keywords = {"hme", "mcp", "server", "tool", "evolution_", "coupling_",
                         "synthesis", "reasoning", "before_editing", "module_intel",
                         "coupling_intel", "what_did_i_forget", "pipeline_digest",
                         "split", "extract", "refactor", "kb_seed", "hot_reload"}
        hme_kb = [k for k in (ctx.project_engine.list_knowledge_full() or [])
                  if any(t in (k.get("title","") + k.get("content","")).lower()
                         for t in _hme_keywords)]
        for k in hme_kb[-8:]:  # most recent 8 entries
            injected_state += f"  [{k['category']}] {k['title']}: {k['content'][:200]}\n"
    elif is_evolution_q:
        try:
            from .coupling import antagonism_leverage as _ant_leverage, dimension_gap_finder as _dim_gaps
            # Use leverage data (concrete bridge recommendations with file paths, correlations,
            # and opposing-response recipes) instead of raw antagonist_map
            leverage_full = _ant_leverage(pair_limit=3)
            injected_state = "## Live Project State\n### Top 3 Antagonist Leverage Opportunities:\n"
            injected_state += leverage_full[:1600]
            injected_state += "\n\n### Dimension gaps (underused coupling signals):\n"
            injected_state += _dim_gaps()[:400]
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
        _HME_TOOL_INVENTORY = (
            "Current HME tools: before_editing, what_did_i_forget, module_intel (story/impact/both), "
            "coupling_intel (full/network/antagonists/personalities/gaps/leverage/channels/cascade/ledger), "
            "think, trace_query (module/causal), codebase_health, pipeline_digest, regime_report, "
            "section_compare, trust_report, audio_analyze, file_intel, file_lines, grep, search_code, "
            "find_callers, find_anti_pattern, get_function_body, diagnose_error, hme_admin, "
            "add_knowledge, remove_knowledge, search_knowledge, check_pipeline, bulk_rename_preview."
        )
        prompt = (
            f"Question: {about}\n\n"
            f"You are reasoning about HME (HyperMeta Ecstasy) tooling improvements — "
            f"NOT about music source code changes. {_HME_TOOL_INVENTORY} "
            f"Focus on: tool UX gaps, missing capabilities, workflows that still require manual "
            f"mental work, and new tool ideas that would make the system feel more alive and "
            f"self-aware. Reference specific existing tool names from the inventory above. "
            f"Be concrete about what exists, what's missing, and why the gap matters "
            f"for the evolution workflow. Max 5 items, no code file paths."
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

    # Ollama path: route by question type for best quality
    raw_context = ""

    # Inject query-aware session narrative — callers/search queries get search+think
    # history; architectural questions get edit+review+pipeline context.
    from .synthesis_session import get_session_narrative as _get_narr
    _about_lower = about.lower()
    if any(k in _about_lower for k in ("caller", "find", "grep", "where", "search")):
        _narr_cats = ["search", "think"]
    elif any(k in _about_lower for k in ("evolv", "pipeline", "round", "next")):
        _narr_cats = ["pipeline", "kb", "commit"]
    else:
        _narr_cats = ["think", "edit", "search"]
    _narr = _get_narr(max_entries=6, categories=_narr_cats)
    if _narr:
        raw_context += _narr

    # Inject think continuation history — cross-call session memory
    _hist = get_think_history_context()
    if _hist:
        raw_context += _hist
    if injected_state:
        raw_context += injected_state + "\n\n"
    if context:
        raw_context += f"Additional context: {context}\n\n"
    if kb_block:
        raw_context += kb_block + "\n\n"

    if _is_meta_hme:
        # Meta-HME: single-stage reasoning (qwen3:30b-a3b) with HME doc+KB context.
        # _two_stage_think falls back to single-stage anyway (no src/ paths in meta-HME context)
        # so skip Stage 1 entirely — faster and equally accurate for tool UX questions.
        # Inject _THINK_SYSTEM so the model knows the alien music + HME domain from the start.
        local_answer = _local_think(
            raw_context[:10000] + "\n\n" + prompt,
            max_tokens=4096, model=_REASONING_MODEL,
            system=_THINK_SYSTEM,
        )
        if local_answer:
            local_answer = _ground_file_paths(local_answer)
            store_think_history(about, local_answer)
            return f"# Think: {about} *(meta-hme)*\n\n{local_answer}"
    elif not is_evolution_q and not is_channel_q and not _is_pipeline_infra:
        # Route by complexity (heuristic, zero latency):
        # ≥ 3 → cascade (arbiter plan + source injection + coder + reasoner)
        # == 2 → enrich raw_context with live source, then parallel two-stage
        # < 2 → parallel two-stage with KB context only
        _complexity = _assess_complexity(about)
        if _complexity["complexity"] >= 3:
            logger.info(f"think: routing to cascade (complexity={_complexity['complexity']})")
            local_answer = _cascade_synthesis(
                prompt, raw_context[:8000] + "\n\n" + prompt, max_tokens=4096,
            )
            if local_answer:
                local_answer = _ground_file_paths(local_answer)
                store_think_history(about, local_answer)
                return f"# Think: {about} *(cascade c={_complexity['complexity']})*\n\n{local_answer}"
            logger.info("think: cascade returned None, falling through to parallel")
        elif _complexity["complexity"] == 2:
            # Enriched: inject live source into raw_context so parallel pipeline
            # works from actual code, not just KB abstractions.
            for _m in _fuzzy_find_modules(about, max_results=2):
                _src = _read_module_source(_m, max_chars=1500)
                if _src:
                    raw_context += f"\n\n[Live source: {_m}]\n{_src}"
                    logger.info(f"think: enriched raw_context with live source for {_m}")

    if not _is_meta_hme:
        # Code/evolution questions: parallel two-stage (GPU 0 + GPU 1 simultaneously)
        # Pipeline infrastructure questions skip the crossLayer file list — injecting
        # src/ module paths causes the models to hallucinate crossLayer answers for
        # questions that are actually about scripts/pipeline/*.js files.
        if not _is_pipeline_infra:
            if is_channel_q:
                raw_context += (
                    "TERMINOLOGY: 'dead-end channel' means an L0 channel that is posted (produced) but has "
                    "ZERO consumers — no module reads it. 'Consuming' a dead-end channel means adding "
                    "L0.getLast('channelName', {layer:'both'}) to a new consumer module to read its data.\n\n"
                )
            import glob as _cl_glob
            _cl_files = sorted(_cl_glob.glob(
                os.path.join(ctx.PROJECT_ROOT, "src", "crossLayer", "**", "*.js"), recursive=True
            ))
            _cl_rel = [f.replace(ctx.PROJECT_ROOT + "/", "") for f in _cl_files
                       if not os.path.basename(f).startswith("index")]
            raw_context += (
                "Polychron crossLayer module FILE PATHS (auto-generated):\n  "
                + ",\n  ".join(_cl_rel[:32]) + ".\n"
                "L0 channels read via: const entry = L0.getLast('channelName', {layer:'both'}); "
                "Each channel posts specific fields — check the producer source code above for exact field names. "
                "Common patterns: emergentRhythm posts {density, complexity, hotspots}, "
                "harmonicFunction posts {fn, chordRoot, keyRoot}, motifEcho posts {delayBeats, interval}."
            )
        # Parallel synthesis: GPU 0 (extract) + GPU 1 (analyze) run simultaneously,
        # then GPU 1 produces final answer from merged brief. ~2x faster than sequential.
        # max_tokens=1024: final answer is ≤4 items → caps chat stage at ~70s (vs 8192=546s).
        # All processing from Stage 1 threads is preserved in the merged brief fallback.
        local_answer = _parallel_two_stage_think(raw_context, prompt, max_tokens=2048)
        if local_answer:
            local_answer = _ground_file_paths(local_answer)
            store_think_history(about, local_answer)
            return f"# Think: {about} *(parallel-two-stage)*\n\n{local_answer}"

    # Template fallback (Ollama unavailable): minimal context, no injected_state echo
    # Access _last_think_failure via module reference — direct import gives stale value after mutation.
    from . import synthesis_ollama as _syn_mod
    _fallback_label = (
        "Ollama TIMEOUT — queue may be stacked. Do NOT retry. Wait for queue to drain or restart Ollama."
        if _syn_mod._last_think_failure == "timeout"
        else "Ollama unavailable — fallback"
    )
    logger.warning(f"think({about!r}): synthesis unavailable — returning KB-only template fallback")
    parts = [f"# Think: {about} *({_fallback_label})*\n"]
    if kb_hits:
        parts.append("**Relevant KB:**")
        for k in kb_hits[:4]:
            parts.append(f"  [{k['category']}] {k['title']}: {k['content'][:100]}")
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
        # Fallback: symbol may be a property/field name, not an IIFE global.
        # Try grep to find usages as a property reference.
        from server.search_basic import grep as _grep_fn
        grep_result = _grep_fn(symbol_name, path="src/", regex=False, files_only=True)
        if grep_result and "No matches" not in grep_result:
            return (f"# Blast Radius: {symbol_name}\n\n"
                    f"'{symbol_name}' is not an IIFE global — falling back to grep.\n"
                    f"Found as property/field reference:\n\n{grep_result}")
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
        synthesis = _local_think(user_text, max_tokens=1024, model=_REASONING_MODEL,
                                 system=_THINK_SYSTEM)
        if synthesis:
            from .synthesis_ollama import compress_for_claude
            synthesis = compress_for_claude(synthesis, max_chars=800, hint=f"blast radius risk for {symbol_name}")
            parts.append(f"\n## Change Risk *(adaptive)*")
            parts.append(synthesis)
        else:
            logger.warning(f"blast_radius({symbol_name!r}): adaptive synthesis unavailable")

    return "\n".join(parts)
