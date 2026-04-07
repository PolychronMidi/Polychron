"""HME search tools."""
import os
import logging

from server import context as ctx
from server.tools_analysis import _track
from server.helpers import (
    get_context_budget, validate_project_path, fmt_score, fmt_sim_score,
    format_knowledge_results, check_path_in_project,
    BUDGET_LIMITS, CROSSLAYER_BOUNDARY_VIOLATIONS,
    LINE_COUNT_TARGET, LINE_COUNT_WARN,
)
from rag_engine import summarize_chunk
from symbols import find_callers as _find_callers
from analysis import find_similar_code as _find_similar
from tools_index import _resolve_lib_engine, _index_lib  # shared helpers

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def grep(pattern: str, path: str = "", file_type: str = "", context: int = 0, regex: bool = False, files_only: bool = False) -> str:
    """Exact string or regex search across project files, enriched with KB cross-references. Use this instead of built-in Grep for all exact-match searches — it automatically surfaces relevant knowledge constraints alongside results. Set regex=True for extended regex (-E), context=N for surrounding lines (-C), files_only=True for file paths only (-l). Returns up to 30 matching lines plus any KB entries related to the search pattern. For semantic/intent-based searches, use search_code instead."""
    import subprocess
    ctx.ensure_ready_sync()
    if not pattern:
        return "Error: pattern cannot be empty."
    if regex:
        import re as _re
        try:
            _re.compile(pattern)
        except _re.error as e:
            return f"Error: invalid regex pattern: {e}"
    target = os.path.join(ctx.PROJECT_ROOT, path) if path and not os.path.isabs(path) else (path if path else ctx.PROJECT_ROOT)
    if not os.path.realpath(target).startswith(os.path.realpath(ctx.PROJECT_ROOT)):
        return f"Error: path '{path}' is outside the project root."
    cmd = ["grep", "-rn"]
    if file_type:
        cmd.extend(["--include", f"*.{file_type}"])
    if regex:
        cmd.insert(1, "-E")
    if context > 0:
        cmd.extend([f"-C{context}"])
    if files_only:
        cmd = ["grep", "-rl"]
        if file_type:
            cmd.extend(["--include", f"*.{file_type}"])
        if regex:
            cmd.insert(1, "-E")
    cmd.extend([pattern, target])
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        lines = result.stdout.strip().split("\n") if result.stdout.strip() else []
    except Exception as e:
        return f"Grep failed: {e}"
    # Intelligence layer: check KB for constraints related to the search
    kb_hits = ctx.project_engine.search_knowledge(pattern, top_k=2)
    relevant_kb = kb_hits
    parts = []
    if relevant_kb:
        parts.append("## KB Context")
        for k in relevant_kb:
            parts.append(f"  [{k['category']}] {k['title']}: {k['content'][:100]}...")
        parts.append("")
    if not lines:
        parts.append(f"No matches for '{pattern}' in {path}/*.{file_type}")
        return "\n".join(parts)
    # Dedupe by file and add boundary warnings
    shown = lines[:30]
    parts.append(f"## Matches ({len(lines)} lines)")
    for line in shown:
        rel = line.replace(ctx.PROJECT_ROOT + "/", "")
        parts.append(f"  {rel}")
    if len(lines) > 30:
        parts.append(f"  ... and {len(lines) - 30} more")
    return "\n".join(parts)



@ctx.mcp.tool()
def file_lines(file_path: str, start: int = 1, end: int = 0) -> str:
    """Read specific line ranges of a file with automatic KB context for the module. Use this instead of Bash cat/head/tail/sed — it surfaces any knowledge constraints associated with the file's module. Accepts relative paths (resolved against ctx.PROJECT_ROOT) or absolute paths. Specify start and end line numbers to read a range; omit end to read to EOF. Returns numbered lines plus any matching KB entries."""
    ctx.ensure_ready_sync()
    abs_path = validate_project_path(file_path, ctx.PROJECT_ROOT)
    if abs_path is None:
        return f"Error: path '{file_path}' is outside the project root."
    if not os.path.isfile(abs_path):
        return f"File not found: {abs_path}"
    try:
        with open(abs_path, encoding="utf-8", errors="ignore") as f:
            all_lines = f.readlines()
    except Exception as e:
        return f"Error: {e}"
    total = len(all_lines)
    if end > 0 and end < start:
        return f"Error: end ({end}) must be >= start ({start})."
    s = max(1, start) - 1
    e = end if end > 0 else total
    e = min(e, total)
    selected = all_lines[s:e]
    parts = []
    # KB context for this file
    module_name = os.path.basename(abs_path).replace(".js", "").replace(".ts", "")
    kb_hits = ctx.project_engine.search_knowledge(module_name, top_k=1)
    if kb_hits:
        k = kb_hits[0]
        parts.append(f"## KB: [{k['category']}] {k['title']}")
        parts.append("")
    rel = abs_path.replace(ctx.PROJECT_ROOT + "/", "")
    parts.append(f"## {rel} (lines {s+1}-{e} of {total})")
    for i, line in enumerate(selected, start=s+1):
        parts.append(f"{i:4d}  {line.rstrip()}")
    return "\n".join(parts)



def count_lines(path: str = "src", file_type: str = "js") -> str:
    """Count lines per file in a directory, sorted largest-first with convention warnings. Use instead of wc -l. Flags files exceeding the project's 200-line target and 250-line hard limit. Returns the top 30 files by size, total line count, and number of oversize files. Useful for identifying extraction candidates and tracking code bloat. Can also be called with a file path to count a single file."""
    from file_walker import walk_code_files
    if path == "":
        path = "src"
    target = os.path.join(ctx.PROJECT_ROOT, path) if not os.path.isabs(path) else path
    if not os.path.realpath(target).startswith(os.path.realpath(ctx.PROJECT_ROOT)):
        return f"Error: path '{path}' is outside the project root."
    counts = []
    # Handle file path directly (not just directories)
    if os.path.isfile(target):
        try:
            with open(target, encoding="utf-8", errors="ignore") as _f:
                n = sum(1 for _ in _f)
            rel = target.replace(ctx.PROJECT_ROOT + "/", "")
            flag = " *** OVERSIZE" if n > LINE_COUNT_WARN else " * over target" if n > LINE_COUNT_TARGET else ""
            return f"  {n:5d}  {rel}{flag}\n\nTotal: {n} lines"
        except Exception as e:
            return f"Error reading file: {e}"
    for fpath in walk_code_files(target):
        if not str(fpath).endswith(f".{file_type}"):
            continue
        try:
            with open(fpath, encoding="utf-8", errors="ignore") as _f:
                n = sum(1 for _ in _f)
            rel = str(fpath).replace(ctx.PROJECT_ROOT + "/", "")
            counts.append((n, rel))
        except Exception:
            continue
    counts.sort(key=lambda x: -x[0])
    parts = [f"## Line Counts ({len(counts)} .{file_type} files in {path})\n"]
    for n, rel in counts[:30]:
        flag = " *** OVERSIZE" if n > LINE_COUNT_WARN else " * over target" if n > LINE_COUNT_TARGET else ""
        parts.append(f"  {n:5d}  {rel}{flag}")
    if len(counts) > 30:
        parts.append(f"  ... and {len(counts) - 30} more files")
    total = sum(n for n, _ in counts)
    oversize = sum(1 for n, _ in counts if n > LINE_COUNT_WARN)
    parts.append(f"\nTotal: {total} lines | {oversize} oversize files (>{LINE_COUNT_WARN})")
    return "\n".join(parts)



def get_context(query: str, max_tokens: int = 0, language: str = "", path: str = "") -> str:
    """Token-budgeted context assembly with auto context-window awareness.
    query is a natural-language description of what you need (NOT a file path — use file_lines for reading files, or pass file paths via the path parameter to scope results).
    max_tokens=0 means AUTO: reads /tmp/claude-context.json (from status line) to determine budget.
    >75% remaining = greedy (16000), 50-75% = moderate (8000), 25-50% = conservative (3000), <25% = minimal (800).
    max_tokens>0 means MANUAL override."""
    ctx.ensure_ready_sync()
    if not query or not query.strip():
        return "Empty query. Provide a natural-language description of what you're looking for."
    if max_tokens > 0:
        budget = max_tokens
    else:
        # Auto-detect from status line context file
        try:
            import json as _json
            with open("/tmp/claude-context.json") as _ctxf:
                _ctx_data = _json.load(_ctxf)
            remaining = _ctx_data.get("remaining_pct", 50)
            if remaining > 75:
                budget = 16000
            elif remaining > 50:
                budget = 8000
            elif remaining > 25:
                budget = 3000
            else:
                budget = 800
        except Exception:
            budget = 8000  # safe default when context file unavailable
    lang = language if language else None
    # When path filtering, search much wider to compensate for post-filter loss
    search_budget = budget * 8 if path else budget
    results = ctx.project_engine.search_budgeted(query, max_tokens=search_budget, language=lang)
    if path:
        results = [r for r in results if path in r.get('source', '')]
        # Re-trim to actual budget
        trimmed = []
        used = 0
        for r in results:
            ct = len(r.get('content', '')) // 4
            if used + ct > budget:
                break
            trimmed.append(r)
            used += ct
        results = trimmed
    if not results:
        if path:
            return f"No results for '{query}' in path '{path}' within {budget} token budget. Try without the path filter, or use search_code for broader results."
        return f"No results for '{query}' within {budget} token budget. Try broader terms or check index with get_index_status."
    # KB enrichment
    kb_hits = ctx.project_engine.search_knowledge(query, top_k=3)
    relevant_kb = kb_hits
    parts = []
    if relevant_kb:
        parts.append("## KB Context")
        for k in relevant_kb:
            parts.append(f"  [{k['category']}] {k['title']}: {k['content'][:100]}...")
        parts.append("")
    total_tokens = 0
    parts.append(f"## Code ({len(results)} chunks, ~{budget} token budget)")
    for i, r in enumerate(results):
        chunk_tokens = len(r['content']) // 4
        total_tokens += chunk_tokens
        truncated = " (truncated)" if r.get('truncated') else ""
        kb_tag = ""
        if r.get("kb_constraints"):
            kb_tag = f" [KB: {', '.join(r['kb_constraints'][:2])}]"
        parts.append(f"\n### [{i+1}] {r['source'].replace(ctx.PROJECT_ROOT + '/', '')}:{r['start_line']}-{r['end_line']} ({fmt_sim_score(r['score'])}){kb_tag}{truncated}")
        parts.append(f"```{r['language']}")
        parts.append(r['content'])
        parts.append("```")
    ctx_info = ""
    try:
        import json as _json
        with open("/tmp/claude-context.json") as _ctxf:
            _ctx_data = _json.load(_ctxf)
        ctx_info = f" | context: {_ctx_data.get('remaining_pct', '?')}% remaining"
    except Exception:
        pass
    parts.append(f"\n---\nUsed ~{total_tokens} tokens of {budget} budget ({len(results)} chunks){ctx_info}")
    return "\n".join(parts)



@ctx.mcp.tool()
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

    # ── Hybrid search: semantic + keyword fusion ──────────────────────────────
    # Extract code identifiers from query (camelCase, snake_case, module names).
    # Grep for them in parallel with semantic search. Files found by BOTH methods
    # get a score boost. Keyword-only files are appended as fallback results.
    # This is the Ollama-context-equivalent for search: two orthogonal retrieval
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



def find_similar_code(code_snippet: str, top_k: int = 10) -> str:
    """Find code chunks semantically similar to a given snippet. Paste a code fragment and get back the most similar chunks in the codebase, ranked by vector similarity. Useful for finding duplicated logic, parallel implementations, or code that follows the same pattern. Returns file locations, language, similarity scores, and chunk summaries."""
    ctx.ensure_ready_sync()
    top_k = max(1, min(30, top_k))
    results = _find_similar(code_snippet, ctx.project_engine, top_k=top_k)

    if not results:
        return "No similar code found. Make sure the codebase is indexed."

    lines = []
    for i, r in enumerate(results):
        summary = summarize_chunk(r['content'], r['language'])
        lines.append(
            f"[{i+1}] {r['source']}:{r['start_line']}-{r['end_line']} "
            f"({r['language']}, {fmt_sim_score(r['score'])}) {summary}"
        )

    # KB enrichment: surface constraints relevant to the top matching files
    top_modules = list(dict.fromkeys(
        os.path.basename(r['source']).replace('.js', '').replace('.ts', '').replace('.py', '')
        for r in results[:3]
    ))
    kb_hits = []
    seen_kb = set()
    for mod in top_modules:
        for k in ctx.project_engine.search_knowledge(mod, top_k=2):
            if k['id'] not in seen_kb:
                kb_hits.append(k)
                seen_kb.add(k['id'])
    if kb_hits:
        lines.extend(format_knowledge_results(kb_hits, "\n## KB Constraints"))
    return "\n".join(lines)



@ctx.mcp.tool()
def find_callers(symbol_name: str, language: str = "", path: str = "", exclude_path: str = "") -> str:
    """Find all call sites. Use path='src/crossLayer' to scope. Use exclude_path='src/conductor' to find boundary violations."""
    if not symbol_name.strip():
        return "Error: symbol_name cannot be empty."
    if len(symbol_name.strip()) < 2:
        return f"Error: symbol_name '{symbol_name}' is too short (min 2 chars) — would match too many sites."
    results = _find_callers(symbol_name, ctx.PROJECT_ROOT, lang_filter=language)
    # Scoped filtering
    if path:
        results = [r for r in results if path in r.get('file', '')]
    if exclude_path:
        results = [r for r in results if exclude_path not in r.get('file', '')]
    if not results:
        scope_msg = f" (path='{path}')" if path else ""
        exclude_msg = f" (exclude='{exclude_path}')" if exclude_path else ""
        return f"No callers found for '{symbol_name}'{scope_msg}{exclude_msg}."

    lines = [f"  {r['file']}:{r['line']} - {r['text']}" for r in results[:50]]
    overflow = f"\n  ... and {len(results) - 50} more" if len(results) > 50 else ""
    return f"Found {len(results)} call site(s) for '{symbol_name}':\n" + "\n".join(lines) + overflow



@ctx.mcp.tool()
def find_anti_pattern(wrong_symbol: str, right_symbol: str, path: str = "", exclude_path: str = "") -> str:
    """Find boundary violations: files using wrong_symbol (the banned direct access) that should use right_symbol (the approved bridge/wrapper) instead. Example: find_anti_pattern wrong_symbol='conductorState' right_symbol='conductorSignalBridge'. Auto-excludes the file that defines right_symbol."""
    if not wrong_symbol.strip():
        return "Error: wrong_symbol cannot be empty."
    if not right_symbol.strip():
        return "Error: right_symbol cannot be empty."
    wrong_results = _find_callers(wrong_symbol, ctx.PROJECT_ROOT)
    right_results = _find_callers(right_symbol, ctx.PROJECT_ROOT)
    # Auto-exclude files that define/implement the right_symbol (the bridge, not a violation)
    right_base = right_symbol.split('.')[0] if '.' in right_symbol else right_symbol
    if path:
        wrong_results = [r for r in wrong_results if path in r.get('file', '')]
    if exclude_path:
        wrong_results = [r for r in wrong_results if exclude_path not in r.get('file', '')]
    # Auto-exclude bridge definition files (file name contains the right_symbol base name)
    wrong_results = [r for r in wrong_results if right_base.lower() not in os.path.basename(r.get('file', '')).lower()]
    # Files using the wrong symbol
    wrong_files = set(r['file'] for r in wrong_results)
    # Files using the right symbol (these are OK)
    right_files = set(r['file'] for r in right_results)
    # Violations: files using wrong but NOT right
    violations = wrong_files - right_files
    violation_results = [r for r in wrong_results if r['file'] in violations]
    if not violation_results:
        mixed = wrong_files & right_files
        if mixed:
            return f"No pure violations. {len(mixed)} file(s) use both '{wrong_symbol}' and '{right_symbol}' (mixed usage)."
        return f"No files use '{wrong_symbol}' in the specified scope."
    lines = [f"  {r['file'].replace(ctx.PROJECT_ROOT + '/', '')}:{r['line']} - {r['text']}" for r in violation_results[:30]]
    overflow = f"\n  ... and {len(violation_results) - 30} more (use path= to narrow)" if len(violation_results) > 30 else ""
    # Show subsystem breakdown when violations span multiple subsystems
    subsystem_counts: dict = {}
    for r in violation_results:
        rel = r['file'].replace(ctx.PROJECT_ROOT + '/', '')
        parts_path = rel.split('/')
        sub = parts_path[1] if len(parts_path) > 2 and parts_path[0] == 'src' else parts_path[0]
        subsystem_counts[sub] = subsystem_counts.get(sub, 0) + 1
    breakdown = ""
    if len(subsystem_counts) > 1:
        breakdown = "\n  Breakdown: " + ", ".join(f"{k}:{v}" for k, v in sorted(subsystem_counts.items(), key=lambda x: -x[1]))
        breakdown += f"\n  Tip: use path='src/<subsystem>' to scope to a specific layer"
    return f"ANTI-PATTERN: {len(violations)} file(s) use '{wrong_symbol}' but not '{right_symbol}':{breakdown}\n" + "\n".join(lines) + overflow
