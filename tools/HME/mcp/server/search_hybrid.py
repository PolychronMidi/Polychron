"""HME search tools — hybrid semantic+keyword search: search_code."""
import logging
import os

from server import context as ctx
from server.tools_analysis import _track
from server.helpers import fmt_sim_score, format_knowledge_results
from rag_engine import summarize_chunk
from tools_index import _resolve_lib_engine

logger = logging.getLogger("HME")


def search_code(query: str, top_k: int = 10, language: str = "", lib: str = "", scope: str = "main", path: str = "", response_format: str = "detailed") -> str:
    """Semantic natural-language code search across the indexed codebase. Use this for intent-based queries like 'where does convergence detection happen' — it uses vector similarity, not string matching. Set path='src/crossLayer' to scope results to a directory. Set lib='<name>' to search an indexed library. Set scope='all' to include both main and libs. Results include chunk summaries, relevance scores, and any KB constraints tagged to matching modules. For exact string/regex matching, use grep instead. Set response_format='concise' to get file:line locations only (saves ~2/3 tokens); 'detailed' (default) includes full summaries and KB tags."""
    _track("search_code")
    ctx.ensure_ready_sync()
    if not query or not query.strip():
        return "Empty query. Provide a natural-language description of what you're looking for, e.g. 'where does convergence detection happen'."
    top_k = max(1, min(30, top_k))
    lang = language if language else None
    # Scoped search: filter by directory/file path prefix
    path_filter = path.strip().rstrip("/") if path else ""

    output_parts = []

    if lib:
        resolved = _resolve_lib_engine(lib)
        if not resolved:
            available = ", ".join(ctx.lib_engines.keys()) if ctx.lib_engines else "(none)"
            return f"Error: lib '{lib}' not found. Available: {available}"
        lib_key, engine = resolved
        results = engine.search(query, top_k=top_k, language=lang)
        if not results:
            return f"No results in lib '{lib_key}'. Make sure it's indexed (use index_codebase with lib parameter)."
        code_lines = []
        for i, r in enumerate(results):
            summary = summarize_chunk(r['content'], r['language'])
            code_lines.append(
                f"[{i+1}] {r['source']}:{r['start_line']}-{r['end_line']} "
                f"({r['language']}, {fmt_sim_score(r['score'])}) {summary}"
            )
        return f"=== Lib: {lib_key} ===\n" + "\n".join(code_lines)

    concise = response_format == "concise"

    # Hybrid search: semantic + keyword fusion
    # Extract code identifiers from query (camelCase, snake_case, module names).
    # Grep for them in parallel with semantic search. Files found by BOTH methods
    # get a score boost. Keyword-only files are appended as fallback results.
    # This is the llama.cpp-context-equivalent for search: two orthogonal retrieval
    # strategies fused into a single result set for higher precision and recall.
    import re as _re_hybrid, subprocess as _sp_hybrid
    _HYBRID_STOPWORDS = {"where", "does", "which", "what", "when", "that", "this",
                         "with", "from", "have", "been", "into", "make", "more",
                         "about", "would", "should", "could", "their", "there",
                         "these", "those", "using", "every", "other", "after",
                         "modules", "function", "read", "aware", "behavior",
                         "how", "the", "for", "and", "not", "are", "get", "set",
                         "used", "use", "cross", "layer", "best", "next", "given"}
    _id_words = [w for w in _re_hybrid.findall(r'\b[a-zA-Z_][a-zA-Z0-9_]*\b', query)
                 if len(w) >= 4 and w.lower() not in _HYBRID_STOPWORDS]
    # Keep words that look like code identifiers (camelCase, PascalCase, long nouns)
    _identifiers = [w for w in _id_words
                    if any(c.isupper() for c in w[1:]) or '_' in w or len(w) > 6][:5]
    # Keyword grep: find files containing extracted identifiers
    _keyword_hits: dict[str, int] = {}  # file -> hit count
    _rg_scope = os.path.join(ctx.PROJECT_ROOT, path_filter) if path_filter else os.path.join(ctx.PROJECT_ROOT, "src")
    import logging as _log_hybrid
    _logger_hybrid = _log_hybrid.getLogger("HME")
    for _ident in _identifiers:
        try:
            # Use grep (always available) instead of rg (Claude Code wrapper, not a binary).
            _gr = _sp_hybrid.run(
                ["grep", "-rl", "--include=*.js", _ident, _rg_scope],
                capture_output=True, text=True, timeout=10
            )
            if _gr.returncode == 0:
                _matches = [_f.strip() for _f in _gr.stdout.strip().split("\n") if _f.strip()]
                # Skip identifiers that match >20 files (too common = noise, not signal)
                if len(_matches) > 20:
                    continue
                for _f in _matches:
                    _keyword_hits[_f] = _keyword_hits.get(_f, 0) + 1
        except Exception as _e:
            _logger_hybrid.warning(f"hybrid grep failed for '{_ident}': {_e}")
    _logger_hybrid.info(f"search_code hybrid: identifiers={_identifiers}, hits={len(_keyword_hits)} files")
    if _keyword_hits:
        _logger_hybrid.info(f"search_code hybrid: {len(_keyword_hits)} keyword files from {_identifiers}")

    if scope in ("main", "all"):
        if not concise:
            proj_kb = ctx.project_engine.search_knowledge(query, top_k=3)
            glob_kb = ctx.global_engine.search_knowledge(query, top_k=3)
            output_parts.extend(format_knowledge_results(proj_kb, "Project Knowledge"))
            output_parts.extend(format_knowledge_results(glob_kb, "Global Knowledge"))

        results = ctx.project_engine.search(query, top_k=top_k * (3 if path_filter else 1), language=lang)
        if path_filter:
            results = [r for r in results if path_filter in r.get('source', '')][:top_k]
        # Hybrid fusion: boost semantic results that also have keyword matches
        _seen_sources = set()
        for r in results:
            src = r.get('source', '')
            full_src = os.path.join(ctx.PROJECT_ROOT, src) if not src.startswith("/") else src
            if full_src in _keyword_hits or src in _keyword_hits:
                r['score'] = min(r['score'] * 1.20, 0.99)  # 20% boost, cap at 99%
                r['_hybrid'] = True
                _seen_sources.add(full_src)
                _seen_sources.add(src)
            else:
                _seen_sources.add(full_src)
                _seen_sources.add(src)
        # Sort and truncate semantic results first
        results.sort(key=lambda r: r.get('score', 0), reverse=True)
        results = results[:top_k]
        # THEN append keyword-only results that semantic search missed (always visible)
        for _kf, _kcount in sorted(_keyword_hits.items(), key=lambda x: -x[1]):
            if _kf not in _seen_sources and len(results) < top_k + 3:
                _rel_path = _kf.replace(ctx.PROJECT_ROOT + "/", "")
                results.append({
                    'source': _rel_path, 'start_line': 1, 'end_line': 1,
                    'score': min(0.40 + _kcount * 0.12, 0.70), 'language': 'javascript',
                    'content': f'(keyword match: {_kcount} identifiers found)', '_hybrid': True,
                })
        if results:
            code_lines = []
            for i, r in enumerate(results):
                _htag = " [HYBRID]" if r.get('_hybrid') else ""
                if concise:
                    code_lines.append(f"{r['source']}:{r['start_line']} ({fmt_sim_score(r['score'])}){_htag}")
                else:
                    summary = summarize_chunk(r['content'], r['language'])
                    kb_tag = ""
                    if r.get("kb_constraints"):
                        kb_tag = f" [KB: {', '.join(r['kb_constraints'][:2])}]"
                    code_lines.append(
                        f"[{i+1}] {r['source']}:{r['start_line']}-{r['end_line']} "
                        f"({r['language']}, {fmt_sim_score(r['score'])}) {summary}{kb_tag}{_htag}"
                    )
            output_parts.append("=== Main ===\n" + "\n".join(code_lines))

    if scope in ("libs", "all") and ctx.lib_engines:
        for lib_key, engine in ctx.lib_engines.items():
            lib_results = engine.search(query, top_k=min(top_k, 5), language=lang)
            if lib_results:
                code_lines = []
                for i, r in enumerate(lib_results):
                    summary = summarize_chunk(r['content'], r['language'])
                    code_lines.append(
                        f"[{i+1}] {r['source']}:{r['start_line']}-{r['end_line']} "
                        f"({r['language']}, {fmt_sim_score(r['score'])}) {summary}"
                    )
                output_parts.append(f"=== Lib: {lib_key} ===\n" + "\n".join(code_lines))

    if not output_parts:
        status = ctx.project_engine.get_status()
        if not status["indexed"]:
            return "No results: codebase not indexed yet. Run index_codebase first."
        # Auto-retry with shorter query variants (verbose queries dilute semantic signal)
        import re as _re
        _SEARCH_STOPWORDS = {"where", "does", "which", "what", "when", "that", "this",
                             "with", "from", "have", "been", "into", "make", "more",
                             "about", "would", "should", "could", "their", "there",
                             "these", "those", "using", "every", "other", "after",
                             "modules", "function", "read", "aware", "behavior"}
        terms = [w for w in _re.findall(r'\b[a-zA-Z]{3,}\b', query) if w.lower() not in _SEARCH_STOPWORDS]
        retry_results = []
        retry_query = ""
        # Phase 1: shorter query, same path filter
        for n_terms in [min(4, len(terms)), min(2, len(terms))]:
            if n_terms < 1:
                break
            short_query = " ".join(terms[:n_terms])
            if short_query == query:
                continue
            results = ctx.project_engine.search(short_query, top_k=top_k, language=lang)
            if path_filter:
                results = [r for r in results if path_filter in r.get('source', '')][:top_k]
            if results:
                retry_results = results
                retry_query = short_query
                break
        # Phase 2: if path filter yielded nothing, try without it
        if not retry_results and path_filter:
            for n_terms in [min(4, len(terms)), min(2, len(terms)), len(terms)]:
                if n_terms < 1:
                    break
                short_query = " ".join(terms[:n_terms]) if n_terms < len(terms) else " ".join(terms)
                results = ctx.project_engine.search(short_query, top_k=top_k, language=lang)
                if results:
                    retry_results = results[:top_k]
                    retry_query = f"{short_query} (path filter '{path_filter}' dropped — no matches there)"
                    break
        if retry_results:
            code_lines = []
            for r in retry_results:
                if concise:
                    code_lines.append(f"{r['source']}:{r['start_line']} ({fmt_sim_score(r['score'])})")
                else:
                    summary = summarize_chunk(r['content'], r['language'])
                    code_lines.append(
                        f"{r['source']}:{r['start_line']}-{r['end_line']} "
                        f"({r['language']}, {fmt_sim_score(r['score'])}) {summary}"
                    )
            header = f"=== Main (auto-retried: '{retry_query}') ==="
            return header + "\n" + "\n".join(code_lines)
        return f"No results for '{query}'. Try: broader terms, remove path filter, or check spelling. Index has {status.get('total_chunks', '?')} chunks across {status.get('total_files', '?')} files."

    return "\n\n".join(output_parts)
