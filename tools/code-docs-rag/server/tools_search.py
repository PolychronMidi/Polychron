"""code-docs-rag search tools."""
import os
import logging

from server import context as ctx
from server.helpers import (
    get_context_budget, validate_project_path, fmt_score,
    format_knowledge_results, check_path_in_project,
    BUDGET_LIMITS, CROSSLAYER_BOUNDARY_VIOLATIONS,
)
from rag_engine import summarize_chunk
from symbols import find_callers as _find_callers, collect_all_symbols

logger = logging.getLogger("code-docs-rag")

def _resolve_lib_engine(lib: str) -> tuple | None:
    if lib in ctx.lib_engines:
        return lib, ctx.lib_engines[lib]
    for key, engine in ctx.lib_engines.items():
        if key.split("/")[-1] == lib or key.split("\\")[-1] == lib:
            return key, engine
    return None

def _index_lib(lib_key: str, engine) -> tuple[str, dict | str]:
    lib_abs = os.path.normpath(os.path.join(ctx.PROJECT_ROOT, lib_key))
    if not os.path.isdir(lib_abs):
        return lib_key, f"directory not found: {lib_abs}"
    logger.info(f"Indexing lib: {lib_key} -> {lib_abs}")
    return lib_key, engine.index_directory(lib_abs)

def _index_main(target: str) -> dict:
    result = ctx.project_engine.index_directory(target)
    symbols = collect_all_symbols(target)
    sym_result = ctx.project_engine.index_symbols(symbols)
    result["symbols_indexed"] = sym_result["indexed"]
    return result

@ctx.mcp.tool()
def grep(pattern: str, path: str = "src", file_type: str = "js", context: int = 0, regex: bool = False, files_only: bool = False) -> str:
    """Exact string or regex search across project files, enriched with KB cross-references. Use this instead of built-in Grep for all exact-match searches — it automatically surfaces relevant knowledge constraints alongside results. Set regex=True for extended regex (-E), context=N for surrounding lines (-C), files_only=True for file paths only (-l). Returns up to 30 matching lines plus any KB entries related to the search pattern. For semantic/intent-based searches, use search_code instead."""
    import subprocess
    if not pattern:
        return "Error: pattern cannot be empty."
    if regex:
        import re as _re
        try:
            _re.compile(pattern)
        except _re.error as e:
            return f"Error: invalid regex pattern: {e}"
    target = os.path.join(ctx.PROJECT_ROOT, path) if not os.path.isabs(path) else path
    if not os.path.realpath(target).startswith(os.path.realpath(ctx.PROJECT_ROOT)):
        return f"Error: path '{path}' is outside the project root."
    cmd = ["grep", "-rn", "--include", f"*.{file_type}"]
    if regex:
        cmd.insert(1, "-E")
    if context > 0:
        cmd.extend([f"-C{context}"])
    if files_only:
        cmd = ["grep", "-rl", "--include", f"*.{file_type}"]
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



@ctx.mcp.tool()
def count_lines(path: str = "src", file_type: str = "js") -> str:
    """Count lines per file in a directory, sorted largest-first with convention warnings. Use instead of wc -l. Flags files exceeding the project's 200-line target and 250-line hard limit. Returns the top 30 files by size, total line count, and number of oversize files. Useful for identifying extraction candidates and tracking code bloat."""
    from file_walker import walk_code_files
    target = os.path.join(ctx.PROJECT_ROOT, path) if not os.path.isabs(path) else path
    if not os.path.realpath(target).startswith(os.path.realpath(ctx.PROJECT_ROOT)):
        return f"Error: path '{path}' is outside the project root."
    counts = []
    for fpath in walk_code_files(target):
        if not str(fpath).endswith(f".{file_type}"):
            continue
        try:
            n = sum(1 for _ in open(fpath, encoding="utf-8", errors="ignore"))
            rel = str(fpath).replace(ctx.PROJECT_ROOT + "/", "")
            counts.append((n, rel))
        except Exception:
            continue
    counts.sort(key=lambda x: -x[0])
    parts = [f"## Line Counts ({len(counts)} .{file_type} files in {path})\n"]
    for n, rel in counts[:30]:
        flag = " *** OVERSIZE" if n > 250 else " * over target" if n > 200 else ""
        parts.append(f"  {n:5d}  {rel}{flag}")
    if len(counts) > 30:
        parts.append(f"  ... and {len(counts) - 30} more files")
    total = sum(n for n, _ in counts)
    oversize = sum(1 for n, _ in counts if n > 250)
    parts.append(f"\nTotal: {total} lines | {oversize} oversize files (>250)")
    return "\n".join(parts)



@ctx.mcp.tool()
def get_context(query: str, max_tokens: int = 0, language: str = "", path: str = "") -> str:
    """Token-budgeted context assembly with auto context-window awareness.
    max_tokens=0 means AUTO: reads /tmp/claude-context.json (from status line) to determine budget.
    >75% remaining = greedy (8000), 50-75% = moderate (4000), 25-50% = conservative (2000), <25% = minimal (800).
    max_tokens>0 means MANUAL override."""
    if max_tokens > 0:
        budget = max_tokens
    else:
        # Auto-detect from status line context file
        try:
            import json as _json
            ctx = _json.load(open("/tmp/claude-context.json"))
            remaining = ctx.get("remaining_pct", 50)
            if remaining > 75:
                budget = 8000
            elif remaining > 50:
                budget = 4000
            elif remaining > 25:
                budget = 2000
            else:
                budget = 800
        except Exception:
            budget = 4000  # safe default when context file unavailable
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
        parts.append(f"\n### [{i+1}] {r['source'].replace(ctx.PROJECT_ROOT + '/', '')}:{r['start_line']}-{r['end_line']} ({fmt_score(r['score'])}){kb_tag}{truncated}")
        parts.append(f"```{r['language']}")
        parts.append(r['content'])
        parts.append("```")
    ctx_info = ""
    try:
        import json as _json
        ctx = _json.load(open("/tmp/claude-context.json"))
        ctx_info = f" | context: {ctx.get('remaining_pct', '?')}% remaining"
    except Exception:
        pass
    parts.append(f"\n---\nUsed ~{total_tokens} tokens of {budget} budget ({len(results)} chunks){ctx_info}")
    return "\n".join(parts)



@ctx.mcp.tool()
def search_code(query: str, top_k: int = 10, language: str = "", lib: str = "", scope: str = "main", path: str = "", response_format: str = "detailed") -> str:
    """Semantic natural-language code search across the indexed codebase. Use this for intent-based queries like 'where does convergence detection happen' — it uses vector similarity, not string matching. Set path='src/crossLayer' to scope results to a directory. Set lib='<name>' to search an indexed library. Set scope='all' to include both main and libs. Results include chunk summaries, relevance scores, and any KB constraints tagged to matching modules. For exact string/regex matching, use grep instead. Set response_format='concise' to get file:line locations only (saves ~2/3 tokens); 'detailed' (default) includes full summaries and KB tags."""
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
                f"({r['language']}, {fmt_score(r['score'])}) {summary}"
            )
        return f"=== Lib: {lib_key} ===\n" + "\n".join(code_lines)

    concise = response_format == "concise"

    if scope in ("main", "all"):
        if not concise:
            proj_kb = ctx.project_engine.search_knowledge(query, top_k=3)
            glob_kb = ctx.global_engine.search_knowledge(query, top_k=3)
            output_parts.extend(format_knowledge_results(proj_kb, "Project Knowledge"))
            output_parts.extend(format_knowledge_results(glob_kb, "Global Knowledge"))

        results = ctx.project_engine.search(query, top_k=top_k * (3 if path_filter else 1), language=lang)
        if path_filter:
            results = [r for r in results if path_filter in r.get('source', '')][:top_k]
        if results:
            code_lines = []
            for i, r in enumerate(results):
                if concise:
                    code_lines.append(f"{r['source']}:{r['start_line']} ({fmt_score(r['score'])})")
                else:
                    summary = summarize_chunk(r['content'], r['language'])
                    kb_tag = ""
                    if r.get("kb_constraints"):
                        kb_tag = f" [KB: {', '.join(r['kb_constraints'][:2])}]"
                    code_lines.append(
                        f"[{i+1}] {r['source']}:{r['start_line']}-{r['end_line']} "
                        f"({r['language']}, {fmt_score(r['score'])}) {summary}{kb_tag}"
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
                        f"({r['language']}, {fmt_score(r['score'])}) {summary}"
                    )
                output_parts.append(f"=== Lib: {lib_key} ===\n" + "\n".join(code_lines))

    if not output_parts:
        status = ctx.project_engine.get_status()
        if not status["indexed"]:
            return "No results: codebase not indexed yet. Run index_codebase first."
        return f"No results for '{query}'. Try: broader terms, remove path filter, or check spelling. Index has {status.get('total_chunks', '?')} chunks across {status.get('total_files', '?')} files."

    return "\n\n".join(output_parts)



@ctx.mcp.tool()
def find_similar_code(code_snippet: str, top_k: int = 10) -> str:
    """Find code chunks semantically similar to a given snippet. Paste a code fragment and get back the most similar chunks in the codebase, ranked by vector similarity. Useful for finding duplicated logic, parallel implementations, or code that follows the same pattern. Returns file locations, language, similarity scores, and chunk summaries."""
    top_k = max(1, min(30, top_k))
    results = _find_similar(code_snippet, ctx.project_engine, top_k=top_k)

    if not results:
        return "No similar code found. Make sure the codebase is indexed."

    lines = []
    for i, r in enumerate(results):
        summary = summarize_chunk(r['content'], r['language'])
        lines.append(
            f"[{i+1}] {r['source']}:{r['start_line']}-{r['end_line']} "
            f"({r['language']}, {fmt_score(r['score'])}) {summary}"
        )
    return "\n".join(lines)



@ctx.mcp.tool()
def find_callers(symbol_name: str, language: str = "", path: str = "", exclude_path: str = "") -> str:
    """Find all call sites. Use path='src/crossLayer' to scope. Use exclude_path='src/conductor' to find boundary violations."""
    if not symbol_name.strip():
        return "Error: symbol_name cannot be empty."
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
    """Find files using wrong_symbol that should use right_symbol instead. Auto-excludes the file that defines right_symbol (the authorized bridge)."""
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
    lines = [f"  {r['file']}:{r['line']} - {r['text']}" for r in violation_results[:30]]
    overflow = f"\n  ... and {len(violation_results) - 30} more" if len(violation_results) > 30 else ""
    return f"ANTI-PATTERN: {len(violations)} file(s) use '{wrong_symbol}' but not '{right_symbol}':\n" + "\n".join(lines) + overflow



