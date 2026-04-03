import os
import sys
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("sentence_transformers").setLevel(logging.WARNING)
logging.getLogger("huggingface_hub").setLevel(logging.WARNING)
logger = logging.getLogger("code-docs-rag")
logger.setLevel(logging.INFO)

from sentence_transformers import SentenceTransformer
from mcp.server.fastmcp import FastMCP
from rag_engine import RAGEngine, summarize_chunk
from lang_registry import ext_to_lang
from file_walker import init_config, get_lib_dirs
from analysis import (
    get_dependency_graph as _get_dep_graph,
    find_similar_code as _find_similar,
    trace_cross_language as _trace_cross_lang,
)
from symbols import (
    collect_all_symbols,
    find_callers as _find_callers,
    get_type_hierarchy as _get_type_hierarchy,
    preview_rename as _preview_rename,
)
from structure import (
    file_summary as _file_summary,
    module_map as _module_map,
    format_module_map as _format_module_map,
)

from watcher import start_watcher

PROJECT_ROOT = os.environ.get("PROJECT_ROOT") or os.getcwd()
PROJECT_DB = os.environ.get("RAG_DB_PATH") or os.path.join(PROJECT_ROOT, ".claude", "mcp", "code-docs-rag")
GLOBAL_DB = os.path.join(os.path.expanduser("~"), ".claude", "mcp", "code-docs-rag", "global_kb")
MODEL_NAME = os.environ.get("RAG_MODEL", "all-mpnet-base-v2")
MODEL_BACKEND = os.environ.get("RAG_BACKEND", "onnx")  # "onnx" (faster) or "torch" (fallback)

os.makedirs(PROJECT_DB, exist_ok=True)
os.makedirs(GLOBAL_DB, exist_ok=True)

init_config(PROJECT_ROOT)

try:
    shared_model = SentenceTransformer(MODEL_NAME, backend=MODEL_BACKEND, model_kwargs={"file_name": "onnx/model.onnx"})
    logger.info(f"Loaded {MODEL_NAME} with {MODEL_BACKEND} backend")
except Exception as e:
    logger.warning(f"{MODEL_BACKEND} backend failed ({e}), falling back to torch")
    shared_model = SentenceTransformer(MODEL_NAME)
project_engine = RAGEngine(db_path=PROJECT_DB, model=shared_model)
global_engine = RAGEngine(db_path=GLOBAL_DB, model=shared_model)

_watcher = start_watcher(PROJECT_ROOT, project_engine)

lib_engines: dict[str, RAGEngine] = {}
for _lib_rel in get_lib_dirs():
    _lib_name = _lib_rel.replace("/", "_").replace("\\", "_").strip("_")
    _lib_db = os.path.join(PROJECT_DB, "libs", _lib_name)
    os.makedirs(_lib_db, exist_ok=True)
    lib_engines[_lib_rel] = RAGEngine(db_path=_lib_db, model=shared_model)
    logger.info(f"Lib engine created: {_lib_rel} -> {_lib_db}")

mcp = FastMCP(
    "code-docs-rag",
    instructions=(
        "Use search_knowledge before modifying a module to check for existing constraints.\n"
        "Use search_code or find_callers for open-ended code searches (they add KB context that Grep misses).\n"
        "After batch code changes: run index_codebase once. File watcher handles individual saves.\n"
        "After user-confirmed rounds: add_knowledge for calibration anchors and decisions.\n"
        "See doc/code-docs-rag.md for the full workflow."
    ),
)

logger.info(f"code-docs-rag started | project={PROJECT_ROOT} | project_db={PROJECT_DB} | global_db={GLOBAL_DB} | libs={list(lib_engines.keys())}")


def _get_context_budget() -> str:
    """Read context-window pressure from status line. Returns 'greedy', 'moderate', 'conservative', or 'minimal'."""
    try:
        import json as _json
        ctx = _json.load(open("/tmp/claude-context.json"))
        remaining = ctx.get("remaining_pct", 50)
        if remaining > 75:
            return "greedy"
        elif remaining > 50:
            return "moderate"
        elif remaining > 25:
            return "conservative"
        else:
            return "minimal"
    except Exception:
        return "moderate"


# Budget-aware limits for composite tool output
_BUDGET_LIMITS = {
    "greedy":       {"kb_entries": 5, "callers": 10, "symbols": 15, "kb_content": 200, "similar": 3},
    "moderate":     {"kb_entries": 3, "callers": 8,  "symbols": 12, "kb_content": 150, "similar": 2},
    "conservative": {"kb_entries": 2, "callers": 5,  "symbols": 8,  "kb_content": 100, "similar": 1},
    "minimal":      {"kb_entries": 1, "callers": 3,  "symbols": 5,  "kb_content": 60,  "similar": 0},
}


def _format_knowledge_results(results: list[dict], label: str) -> list[str]:
    if not results:
        return []
    lines = []
    for k in results:
        tags_str = ", ".join(k["tags"]) if k["tags"] else ""
        lines.append(
            f"  [{k['category']}] {k['title']} (score: {k['score']:.1%}){' | ' + tags_str if tags_str else ''}\n"
            f"  {k['content']}"
        )
    return [f"=== {label} ===\n" + "\n\n".join(lines)]


def _resolve_lib_engine(lib: str) -> tuple[str, RAGEngine] | None:
    if lib in lib_engines:
        return lib, lib_engines[lib]
    for key, engine in lib_engines.items():
        if key.split("/")[-1] == lib or key.split("\\")[-1] == lib:
            return key, engine
    return None


def _index_lib(lib_key: str, engine: RAGEngine) -> tuple[str, dict | str]:
    lib_abs = os.path.normpath(os.path.join(PROJECT_ROOT, lib_key))
    if not os.path.isdir(lib_abs):
        return lib_key, f"directory not found: {lib_abs}"
    logger.info(f"Indexing lib: {lib_key} -> {lib_abs}")
    return lib_key, engine.index_directory(lib_abs)


def _index_main(target: str) -> dict:
    result = project_engine.index_directory(target)
    symbols = collect_all_symbols(target)
    sym_result = project_engine.index_symbols(symbols)
    result["symbols_indexed"] = sym_result["indexed"]
    return result


@mcp.tool()
def grep(pattern: str, path: str = "src", file_type: str = "js", context: int = 0, regex: bool = False, files_only: bool = False) -> str:
    """Exact string or regex search across project files, enriched with KB cross-references. Use this instead of built-in Grep for all exact-match searches — it automatically surfaces relevant knowledge constraints alongside results. Set regex=True for extended regex (-E), context=N for surrounding lines (-C), files_only=True for file paths only (-l). Returns up to 30 matching lines plus any KB entries related to the search pattern. For semantic/intent-based searches, use search_code instead."""
    import subprocess
    target = os.path.join(PROJECT_ROOT, path) if not os.path.isabs(path) else path
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
    kb_hits = project_engine.search_knowledge(pattern, top_k=2)
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
        rel = line.replace(PROJECT_ROOT + "/", "")
        parts.append(f"  {rel}")
    if len(lines) > 30:
        parts.append(f"  ... and {len(lines) - 30} more")
    return "\n".join(parts)


@mcp.tool()
def file_lines(file_path: str, start: int = 1, end: int = 0) -> str:
    """Read specific line ranges of a file with automatic KB context for the module. Use this instead of Bash cat/head/tail/sed — it surfaces any knowledge constraints associated with the file's module. Accepts relative paths (resolved against PROJECT_ROOT) or absolute paths. Specify start and end line numbers to read a range; omit end to read to EOF. Returns numbered lines plus any matching KB entries."""
    abs_path = file_path if os.path.isabs(file_path) else os.path.join(PROJECT_ROOT, file_path)
    if not os.path.isfile(abs_path):
        return f"File not found: {abs_path}"
    try:
        all_lines = open(abs_path, encoding="utf-8", errors="ignore").readlines()
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
    kb_hits = project_engine.search_knowledge(module_name, top_k=1)
    if kb_hits:
        k = kb_hits[0]
        parts.append(f"## KB: [{k['category']}] {k['title']}")
        parts.append("")
    rel = abs_path.replace(PROJECT_ROOT + "/", "")
    parts.append(f"## {rel} (lines {s+1}-{e} of {total})")
    for i, line in enumerate(selected, start=s+1):
        parts.append(f"{i:4d}  {line.rstrip()}")
    return "\n".join(parts)


@mcp.tool()
def count_lines(path: str = "src", file_type: str = "js") -> str:
    """Count lines per file in a directory, sorted largest-first with convention warnings. Use instead of wc -l. Flags files exceeding the project's 200-line target and 250-line hard limit. Returns the top 30 files by size, total line count, and number of oversize files. Useful for identifying extraction candidates and tracking code bloat."""
    from file_walker import walk_code_files
    target = os.path.join(PROJECT_ROOT, path) if not os.path.isabs(path) else path
    counts = []
    for fpath in walk_code_files(target):
        if not str(fpath).endswith(f".{file_type}"):
            continue
        try:
            n = sum(1 for _ in open(fpath, encoding="utf-8", errors="ignore"))
            rel = str(fpath).replace(PROJECT_ROOT + "/", "")
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


@mcp.tool()
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
    # When path filtering, search wider to compensate for post-filter loss
    search_budget = budget * 3 if path else budget
    results = project_engine.search_budgeted(query, max_tokens=search_budget, language=lang)
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
        return f"No results for '{query}' within {budget} token budget."
    # KB enrichment
    kb_hits = project_engine.search_knowledge(query, top_k=3)
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
        parts.append(f"\n### [{i+1}] {r['source'].replace(PROJECT_ROOT + '/', '')}:{r['start_line']}-{r['end_line']} ({r['score']:.0%}){kb_tag}{truncated}")
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


@mcp.tool()
def recent_changes(since: str = "1 hour ago") -> str:
    """Show recently changed files with KB context. Great after context compaction to recover what was modified."""
    import subprocess
    try:
        result = subprocess.run(
            ["git", "-C", PROJECT_ROOT, "diff", "--name-only", "--diff-filter=M"],
            capture_output=True, text=True, timeout=5
        )
        unstaged = [f for f in result.stdout.strip().split("\n") if f.strip()]
    except Exception:
        unstaged = []
    try:
        result = subprocess.run(
            ["git", "-C", PROJECT_ROOT, "diff", "--cached", "--name-only"],
            capture_output=True, text=True, timeout=5
        )
        staged = [f for f in result.stdout.strip().split("\n") if f.strip()]
    except Exception:
        staged = []
    try:
        result = subprocess.run(
            ["git", "-C", PROJECT_ROOT, "log", f"--since={since}", "--name-only", "--pretty=format:", "--diff-filter=M"],
            capture_output=True, text=True, timeout=5
        )
        committed = list(set(f for f in result.stdout.strip().split("\n") if f.strip()))
    except Exception:
        committed = []
    all_files = sorted(set(unstaged + staged + committed))
    if not all_files:
        return f"No changes found since '{since}'."
    parts = [f"## Recent Changes (since {since})\n"]
    for f in all_files:
        status = []
        if f in unstaged: status.append("modified")
        if f in staged: status.append("staged")
        if f in committed: status.append("committed")
        # KB context
        module = os.path.basename(f).replace(".js", "").replace(".ts", "").replace(".md", "")
        kb_hits = project_engine.search_knowledge(module, top_k=1)
        kb_tag = ""
        if kb_hits:
            kb_tag = f" [KB: {kb_hits[0]['title'][:50]}]"
        parts.append(f"  {f} ({', '.join(status)}){kb_tag}")
    return "\n".join(parts)


@mcp.tool()
def index_codebase(directory: str = "", lib: str = "") -> str:
    """Reindex all code chunks and symbols for semantic search. Run after batch code changes or when search results seem stale. The file watcher handles individual saves automatically (5s debounce), so this is only needed after bulk operations. Set lib='<name>' to reindex a specific library. With no arguments, reindexes the main project and all configured libraries in parallel. Also rebuilds the symbol index. Returns file/chunk/symbol counts."""
    if lib:
        resolved = _resolve_lib_engine(lib)
        if not resolved:
            available = ", ".join(lib_engines.keys()) if lib_engines else "(none)"
            return f"Error: lib '{lib}' not found. Available: {available}"
        lib_key, engine = resolved
        lib_key, result = _index_lib(lib_key, engine)
        if isinstance(result, str):
            return f"Error: {result}"
        return (
            f"Lib '{lib_key}' indexing complete:\n"
            f"  Total files scanned: {result['total_files']}\n"
            f"  Files indexed (new/changed): {result['indexed']}\n"
            f"  Files skipped (unchanged): {result['skipped_unchanged']}\n"
            f"  Chunks created: {result['chunks_created']}"
        )

    target = directory if directory else PROJECT_ROOT
    if not os.path.isdir(target):
        return f"Error: directory not found: {target}"

    futures = {}
    with ThreadPoolExecutor(max_workers=max(1, len(lib_engines) + 1)) as pool:
        futures["__main__"] = pool.submit(_index_main, target)
        for lib_key, engine in lib_engines.items():
            futures[lib_key] = pool.submit(_index_lib, lib_key, engine)

        lines = []
        for key, future in futures.items():
            try:
                r = future.result()
            except Exception as e:
                lines.append(f"[{key}] Error: {e}")
                continue

            if key == "__main__":
                lines.insert(0,
                    f"[main] files={r['total_files']} indexed={r['indexed']} "
                    f"skipped={r['skipped_unchanged']} chunks={r['chunks_created']} "
                    f"symbols={r['symbols_indexed']}"
                )
            else:
                lib_name, lib_result = r
                if isinstance(lib_result, str):
                    lines.append(f"[{lib_name}] Error: {lib_result}")
                else:
                    lines.append(
                        f"[{lib_name}] files={lib_result['total_files']} indexed={lib_result['indexed']} "
                        f"skipped={lib_result['skipped_unchanged']} chunks={lib_result['chunks_created']}"
                    )

    return "Indexing complete:\n" + "\n".join(lines)


@mcp.tool()
def search_code(query: str, top_k: int = 10, language: str = "", lib: str = "", scope: str = "main", path: str = "", response_format: str = "detailed") -> str:
    """Semantic natural-language code search across the indexed codebase. Use this for intent-based queries like 'where does convergence detection happen' — it uses vector similarity, not string matching. Set path='src/crossLayer' to scope results to a directory. Set lib='<name>' to search an indexed library. Set scope='all' to include both main and libs. Results include chunk summaries, relevance scores, and any KB constraints tagged to matching modules. For exact string/regex matching, use grep instead. Set response_format='concise' to get file:line locations only (saves ~2/3 tokens); 'detailed' (default) includes full summaries and KB tags."""
    top_k = max(1, min(30, top_k))
    lang = language if language else None
    # Scoped search: filter by directory/file path prefix
    path_filter = path.strip().rstrip("/") if path else ""

    output_parts = []

    if lib:
        resolved = _resolve_lib_engine(lib)
        if not resolved:
            available = ", ".join(lib_engines.keys()) if lib_engines else "(none)"
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
                f"({r['language']}, {r['score']:.0%}) {summary}"
            )
        return f"=== Lib: {lib_key} ===\n" + "\n".join(code_lines)

    concise = response_format == "concise"

    if scope in ("main", "all"):
        if not concise:
            proj_kb = project_engine.search_knowledge(query, top_k=3)
            glob_kb = global_engine.search_knowledge(query, top_k=3)
            output_parts.extend(_format_knowledge_results(proj_kb, "Project Knowledge"))
            output_parts.extend(_format_knowledge_results(glob_kb, "Global Knowledge"))

        results = project_engine.search(query, top_k=top_k * (3 if path_filter else 1), language=lang)
        if path_filter:
            results = [r for r in results if path_filter in r.get('source', '')][:top_k]
        if results:
            code_lines = []
            for i, r in enumerate(results):
                if concise:
                    code_lines.append(f"{r['source']}:{r['start_line']} ({r['score']:.0%})")
                else:
                    summary = summarize_chunk(r['content'], r['language'])
                    kb_tag = ""
                    if r.get("kb_constraints"):
                        kb_tag = f" [KB: {', '.join(r['kb_constraints'][:2])}]"
                    code_lines.append(
                        f"[{i+1}] {r['source']}:{r['start_line']}-{r['end_line']} "
                        f"({r['language']}, {r['score']:.0%}) {summary}{kb_tag}"
                    )
            output_parts.append("=== Main ===\n" + "\n".join(code_lines))

    if scope in ("libs", "all") and lib_engines:
        for lib_key, engine in lib_engines.items():
            lib_results = engine.search(query, top_k=min(top_k, 5), language=lang)
            if lib_results:
                code_lines = []
                for i, r in enumerate(lib_results):
                    summary = summarize_chunk(r['content'], r['language'])
                    code_lines.append(
                        f"[{i+1}] {r['source']}:{r['start_line']}-{r['end_line']} "
                        f"({r['language']}, {r['score']:.0%}) {summary}"
                    )
                output_parts.append(f"=== Lib: {lib_key} ===\n" + "\n".join(code_lines))

    if not output_parts:
        status = project_engine.get_status()
        if not status["indexed"]:
            return "No results: codebase not indexed yet. Run index_codebase first."
        return f"No results for '{query}'. Try: broader terms, remove path filter, or check spelling. Index has {status.get('total_chunks', '?')} chunks across {status.get('total_files', '?')} files."

    return "\n\n".join(output_parts)


@mcp.tool()
def get_index_status() -> str:
    """Check the health and size of all indexes (main project and libraries). Returns file counts, chunk counts, and symbol counts. Use this to verify indexing completed successfully or to diagnose why search results are missing. If the index shows zero files, run index_codebase to build it."""
    status = project_engine.get_status()
    parts = []
    if not status["indexed"]:
        parts.append("Main: No index found. Run index_codebase to create one.")
    else:
        parts.append(
            f"Main index:\n"
            f"  Total files: {status['total_files']}\n"
            f"  Total chunks: {status['total_chunks']}"
        )

    for lib_key, engine in lib_engines.items():
        lib_status = engine.get_status()
        if lib_status["indexed"]:
            parts.append(f"Lib '{lib_key}': {lib_status['total_files']} files, {lib_status['total_chunks']} chunks")
        else:
            parts.append(f"Lib '{lib_key}': not indexed")

    return "\n".join(parts)


@mcp.tool()
def clear_index() -> str:
    """Delete all indexed code chunks, forcing a complete rebuild on next index_codebase call. Use this when the chunker logic has changed or the index is corrupted. Does not affect the knowledge base or symbol index. After clearing, you must run index_codebase to restore search functionality."""
    project_engine.clear()
    return "Index cleared. Run index_codebase to rebuild."


@mcp.tool()
def list_libs() -> str:
    """Show all configured external library directories and their index status. Libraries are configured via ragLibs in .mcp.json. Returns each library's file count and chunk count if indexed, or indicates whether the directory exists but is unindexed. Use index_codebase with lib='<name>' to index a specific library."""
    if not lib_engines:
        return "No external libraries configured. Add ragLibs to .mcp.json to configure."

    parts = [f"Configured libraries ({len(lib_engines)}):"]
    for lib_key, engine in lib_engines.items():
        lib_abs = os.path.normpath(os.path.join(PROJECT_ROOT, lib_key))
        exists = os.path.isdir(lib_abs)
        status = engine.get_status()
        if status["indexed"]:
            parts.append(f"  {lib_key}: {status['total_files']} files, {status['total_chunks']} chunks")
        elif exists:
            parts.append(f"  {lib_key}: not indexed (directory exists)")
        else:
            parts.append(f"  {lib_key}: directory not found ({lib_abs})")

    return "\n".join(parts)


@mcp.tool()
def add_knowledge(title: str, content: str, category: str = "general", tags: str = "", scope: str = "project", related_to: str = "", relation_type: str = "") -> str:
    """Persist a knowledge entry (decision, calibration anchor, pattern, or bugfix) to the KB. Only call this after the user confirms a task is complete — never speculatively. Categories: 'architecture', 'decision', 'pattern', 'bugfix', 'general'. Use related_to=<entry_id> with relation_type (caused_by, fixed_by, depends_on, contradicts, similar_to, supersedes) to create typed graph edges for knowledge_graph traversal. Tags are comma-separated strings. Scope 'project' stores locally, 'global' stores in shared KB, 'both' stores in both. Automatically detects and merges redundant entries or supersedes outdated ones."""
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    results = []

    if scope in ("project", "both"):
        r = project_engine.add_knowledge(title=title, content=content, category=category, tags=tag_list, related_to=related_to, relation_type=relation_type)
        action = r.get("action", "store")
        action_msg = {
            "store": "NEW entry",
            "merge": f"MERGED with existing entry (redundant content combined)",
            "supersede": f"SUPERSEDED existing entry {r.get('superseded', '?')}"
        }.get(action, "stored")
        results.append(f"  [project] ID: {r['id']} ({action_msg})")

    if scope in ("global", "both"):
        r = global_engine.add_knowledge(title=title, content=content, category=category, tags=tag_list, related_to=related_to, relation_type=relation_type)
        action = r.get("action", "store")
        results.append(f"  [global]  ID: {r['id']}")

    return f"Knowledge added ({scope}):\n  Title: {title}\n  Category: {category}\n" + "\n".join(results)


@mcp.tool()
def search_knowledge(query: str, top_k: int = 5, category: str = "") -> str:
    """Search the persistent knowledge base for constraints, decisions, patterns, and bugfixes. MANDATORY before modifying any module — always check for existing constraints first. Returns matching entries from both project and global KBs, ranked by relevance. Filter by category ('architecture', 'decision', 'pattern', 'bugfix') to narrow results. Each result includes ID, title, content, tags, and relevance score."""
    top_k = max(1, min(20, top_k))
    cat = category if category else None

    proj_results = project_engine.search_knowledge(query, top_k=top_k, category=cat)
    glob_results = global_engine.search_knowledge(query, top_k=top_k, category=cat)

    if not proj_results and not glob_results:
        return "No knowledge entries found. Use add_knowledge to build the knowledge base."

    parts = []

    if proj_results:
        lines = []
        for i, r in enumerate(proj_results):
            tags_str = ", ".join(r["tags"]) if r["tags"] else "none"
            lines.append(
                f"[{i+1}] {r['title']} (id: {r['id']}, category: {r['category']}, tags: {tags_str}, score: {r['score']:.1%})\n"
                f"{r['content']}"
            )
        parts.append("=== Project Knowledge ===\n" + "\n\n---\n\n".join(lines))

    if glob_results:
        lines = []
        for i, r in enumerate(glob_results):
            tags_str = ", ".join(r["tags"]) if r["tags"] else "none"
            lines.append(
                f"[{i+1}] {r['title']} (id: {r['id']}, category: {r['category']}, tags: {tags_str}, score: {r['score']:.1%})\n"
                f"{r['content']}"
            )
        parts.append("=== Global Knowledge ===\n" + "\n\n---\n\n".join(lines))

    return "\n\n".join(parts)


@mcp.tool()
def remove_knowledge(entry_id: str, scope: str = "project") -> str:
    """Delete a knowledge entry by its ID. Use after kb_health identifies stale entries, or when a decision has been superseded. Specify scope='global' to remove from the shared KB instead of the project KB."""
    engine = global_engine if scope == "global" else project_engine
    ok = engine.remove_knowledge(entry_id)
    if ok:
        return f"Knowledge entry '{entry_id}' removed from {scope}."
    return f"Failed to remove entry '{entry_id}' from {scope}. It may not exist."


@mcp.tool()
def list_knowledge(category: str = "", scope: str = "") -> str:
    """List all knowledge entries, optionally filtered by category. Returns entry IDs, titles, categories, and tags for both project and global KBs. Use to get an overview of what's in the KB, or filter by category ('architecture', 'decision', 'pattern', 'bugfix') to find specific entry types."""
    cat = category if category else None
    parts = []

    if scope in ("project", ""):
        entries = project_engine.list_knowledge(category=cat)
        if entries:
            status = project_engine.get_knowledge_status()
            header = f"Project KB: {status['total_entries']} entries"
            lines = []
            for e in entries:
                tags_str = ", ".join(e["tags"]) if e["tags"] else ""
                lines.append(f"  - [{e['id']}] {e['title']} ({e['category']}) {tags_str}")
            parts.append(header + "\n" + "\n".join(lines))

    if scope in ("global", ""):
        entries = global_engine.list_knowledge(category=cat)
        if entries:
            status = global_engine.get_knowledge_status()
            header = f"Global KB: {status['total_entries']} entries"
            lines = []
            for e in entries:
                tags_str = ", ".join(e["tags"]) if e["tags"] else ""
                lines.append(f"  - [{e['id']}] {e['title']} ({e['category']}) {tags_str}")
            parts.append(header + "\n" + "\n".join(lines))

    if not parts:
        return "No knowledge entries found."

    return "\n\n".join(parts)


@mcp.tool()
def compact_knowledge(scope: str = "project", threshold: float = 0.85) -> str:
    """Deduplicate the knowledge base by merging entries with high semantic similarity. Use after 30+ entries accumulate. The threshold (0.0-1.0) controls how similar entries must be to merge — 0.85 is a good default. Returns counts of removed vs kept entries. Scope can be 'project', 'global', or 'both'."""
    results = []
    if scope in ("project", "both"):
        r = project_engine.compact_knowledge(similarity_threshold=threshold)
        results.append(f"  [project] removed={r['removed']}, kept={r['kept']}")
    if scope in ("global", "both"):
        r = global_engine.compact_knowledge(similarity_threshold=threshold)
        results.append(f"  [global]  removed={r['removed']}, kept={r['kept']}")
    return "Compaction complete:\n" + "\n".join(results)


@mcp.tool()
def export_knowledge(scope: str = "project", category: str = "") -> str:
    """Export all knowledge entries as markdown for backup or review. Optionally filter by category. Returns formatted markdown with all entry metadata and content. Use for periodic KB snapshots or before major KB reorganization."""
    cat = category if category else None
    parts = []

    if scope in ("project", "both"):
        md = project_engine.export_knowledge(category=cat)
        if md:
            parts.append(f"# Project Knowledge\n\n{md}")

    if scope in ("global", "both"):
        md = global_engine.export_knowledge(category=cat)
        if md:
            parts.append(f"# Global Knowledge\n\n{md}")

    if not parts:
        return "No knowledge entries to export."

    return "\n\n---\n\n".join(parts)


@mcp.tool()
def get_dependency_graph(file_path: str) -> str:
    """Map the import/require dependency graph for a single file. Shows what the file imports (with resolved paths) and which files import it. Accepts relative or absolute paths. Use to understand a file's position in the dependency tree before refactoring or moving it."""
    abs_path = file_path if os.path.isabs(file_path) else os.path.join(PROJECT_ROOT, file_path)
    result = _get_dep_graph(abs_path, PROJECT_ROOT)

    if "error" in result:
        return f"Error: {result['error']}"

    parts = [f"File: {result['file']}"]

    if result["imports"]:
        lines = []
        for imp in result["imports"]:
            resolved = imp["resolved"] or "(unresolved)"
            lines.append(f"  {imp['raw']} -> {resolved}")
        parts.append(f"Imports ({len(result['imports'])}):\n" + "\n".join(lines))
    else:
        parts.append("Imports: none")

    if result["imported_by"]:
        lines = [f"  {f}" for f in result["imported_by"]]
        parts.append(f"Imported by ({len(result['imported_by'])}):\n" + "\n".join(lines))
    else:
        parts.append("Imported by: none")

    return "\n\n".join(parts)


@mcp.tool()
def find_similar_code(code_snippet: str, top_k: int = 10) -> str:
    """Find code chunks semantically similar to a given snippet. Paste a code fragment and get back the most similar chunks in the codebase, ranked by vector similarity. Useful for finding duplicated logic, parallel implementations, or code that follows the same pattern. Returns file locations, language, similarity scores, and chunk summaries."""
    top_k = max(1, min(30, top_k))
    results = _find_similar(code_snippet, project_engine, top_k=top_k)

    if not results:
        return "No similar code found. Make sure the codebase is indexed."

    lines = []
    for i, r in enumerate(results):
        summary = summarize_chunk(r['content'], r['language'])
        lines.append(
            f"[{i+1}] {r['source']}:{r['start_line']}-{r['end_line']} "
            f"({r['language']}, {r['score']:.0%}) {summary}"
        )
    return "\n".join(lines)


@mcp.tool()
def index_symbols() -> str:
    """Rebuild the symbol index from scratch. Scans all project files for IIFE globals, inner functions, classes, and other named symbols. Usually called automatically by index_codebase, but can be run independently after symbol-focused changes. Returns counts broken down by symbol kind."""
    symbols = collect_all_symbols(PROJECT_ROOT)
    result = project_engine.index_symbols(symbols)
    by_kind: dict[str, int] = {}
    for s in symbols:
        by_kind[s["kind"]] = by_kind.get(s["kind"], 0) + 1
    kind_str = ", ".join(f"{v} {k}s" for k, v in sorted(by_kind.items(), key=lambda x: -x[1]))
    return f"Symbol index built: {result['indexed']} symbols ({kind_str})"


@mcp.tool()
def lookup_symbol(name: str, kind: str = "", language: str = "") -> str:
    """Find where a symbol is defined by exact name match. Returns the file, line number, kind (global, function, class), and signature for each match. Use kind='global' to filter to IIFE globals only, or kind='function' for inner functions. For fuzzy/semantic symbol search, use search_symbols instead."""
    results = project_engine.lookup_symbol(name, kind=kind, language=language)
    if not results:
        status = project_engine.get_symbol_status()
        if not status["indexed"]:
            return "No symbol index found. Run index_symbols first."
        return f"No symbols matching '{name}' found."

    lines = []
    for r in results:
        sig = f" {r['signature']}" if r['signature'] else ""
        lines.append(f"  [{r['kind']}] {r['name']}{sig}  ({r['file']}:{r['line']})")
    return f"Found {len(results)} symbol(s):\n" + "\n".join(lines)


@mcp.tool()
def search_symbols(query: str, top_k: int = 20, kind: str = "") -> str:
    """Semantic search across the symbol index. Unlike lookup_symbol (exact match), this finds symbols whose names or signatures are semantically similar to the query. Use kind='global' to filter to IIFE globals, 'function' for inner functions. Returns ranked results with file locations, kinds, signatures, and relevance scores."""
    top_k = max(1, min(50, top_k))
    results = project_engine.search_symbols(query, top_k=top_k, kind=kind)
    if not results:
        status = project_engine.get_symbol_status()
        if not status["indexed"]:
            return "No symbol index found. Run index_symbols first."
        return "No matching symbols found."

    lines = []
    for i, r in enumerate(results):
        sig = f" {r['signature']}" if r['signature'] else ""
        lines.append(
            f"[{i+1}] [{r['kind']}] {r['name']}{sig}\n"
            f"     {r['file']}:{r['line']} ({r['language']}, score: {r['score']:.1%})"
        )
    return "\n".join(lines)


@mcp.tool()
def get_file_summary(file_path: str) -> str:
    """Get a structural overview of a file: line count, symbol kinds, and all symbol definitions with line numbers and signatures. Use to quickly understand a file's API surface without reading the full source. Accepts relative or absolute paths."""
    abs_path = file_path if os.path.isabs(file_path) else os.path.join(PROJECT_ROOT, file_path)
    result = _file_summary(abs_path)

    if "error" in result:
        return f"Error: {result['error']}"

    parts = [f"File: {result['file']} ({result['lines']} lines)"]

    if result["by_kind"]:
        kind_str = ", ".join(f"{v} {k}(s)" for k, v in sorted(result["by_kind"].items(), key=lambda x: -x[1]))
        parts.append(f"Symbols: {kind_str}")

    if result["symbols"]:
        by_kind: dict[str, list] = {}
        for s in result["symbols"]:
            by_kind.setdefault(s["kind"], []).append(s)

        for kind, syms in sorted(by_kind.items()):
            lines = []
            for s in syms[:30]:
                sig = f" {s['signature']}" if s['signature'] else ""
                lines.append(f"    L{s['line']}: {s['name']}{sig}")
            overflow = f"\n    ... and {len(syms) - 30} more" if len(syms) > 30 else ""
            parts.append(f"  [{kind}]\n" + "\n".join(lines) + overflow)

    return "\n".join(parts)


@mcp.tool()
def get_module_map(directory: str = "", max_depth: int = 3) -> str:
    """Show the directory tree structure with line counts per file. Use to get a bird's-eye view of a subsystem's organization. Set directory='src/crossLayer' to scope to a subdirectory, or omit for the full project. max_depth controls how deep to recurse (default 3)."""
    target = os.path.join(PROJECT_ROOT, directory) if directory else PROJECT_ROOT
    if not os.path.isdir(target):
        return f"Error: directory not found: {target}"

    tree = _module_map(target, max_depth=max_depth)
    formatted = _format_module_map(tree)
    return formatted if formatted else "Empty directory or no code files found."


@mcp.tool()
def find_callers(symbol_name: str, language: str = "", path: str = "", exclude_path: str = "") -> str:
    """Find all call sites. Use path='src/crossLayer' to scope. Use exclude_path='src/conductor' to find boundary violations."""
    results = _find_callers(symbol_name, PROJECT_ROOT, lang_filter=language)
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


@mcp.tool()
def find_anti_pattern(wrong_symbol: str, right_symbol: str, path: str = "", exclude_path: str = "") -> str:
    """Find files using wrong_symbol that should use right_symbol instead. Auto-excludes the file that defines right_symbol (the authorized bridge)."""
    wrong_results = _find_callers(wrong_symbol, PROJECT_ROOT)
    right_results = _find_callers(right_symbol, PROJECT_ROOT)
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


@mcp.tool()
def impact_analysis(symbol_name: str, language: str = "") -> str:
    """Analyze the impact of changing a symbol: who calls it, what it calls, and knowledge constraints."""
    parts = []
    # Who calls this?
    callers = _find_callers(symbol_name, PROJECT_ROOT, lang_filter=language)
    caller_files = sorted(set(r['file'].replace(PROJECT_ROOT + '/', '') for r in callers))
    parts.append(f"## Callers ({len(callers)} sites in {len(caller_files)} files)")
    for f in caller_files[:15]:
        parts.append(f"  {f}")
    if len(caller_files) > 15:
        parts.append(f"  ... and {len(caller_files) - 15} more files")
    # What does it call? (via cross_language_trace)
    trace = _trace_cross_lang(symbol_name, PROJECT_ROOT)
    if trace.get("ts_callers"):
        parts.append(f"\n## References ({len(trace['ts_callers'])} total)")
        for ref in trace["ts_callers"][:10]:
            parts.append(f"  {ref['file'].replace(PROJECT_ROOT + '/', '')}:{ref['line']}")
    # Knowledge constraints
    kb_results = project_engine.search_knowledge(symbol_name, top_k=3)
    relevant_kb = [k for k in kb_results if k["score"] > 0.2]
    if relevant_kb:
        parts.append(f"\n## Knowledge Constraints ({len(relevant_kb)} entries)")
        for k in relevant_kb:
            parts.append(f"  [{k['category']}] {k['title']}")
            parts.append(f"    {k['content'][:120]}...")
    else:
        parts.append("\n## Knowledge Constraints: none found")
    # File summary
    syms = collect_all_symbols(PROJECT_ROOT)
    matching = [s for s in syms if s["name"] == symbol_name]
    if matching:
        s = matching[0]
        parts.append(f"\n## Definition: {s['file'].replace(PROJECT_ROOT + '/', '')}:{s['line']} [{s['kind']}]")
    return "\n".join(parts)


@mcp.tool()
def convention_check(file_path: str) -> str:
    """Check a file against project conventions: line count, naming, registration, boundary rules."""
    abs_path = file_path if os.path.isabs(file_path) else os.path.join(PROJECT_ROOT, file_path)
    if not os.path.isfile(abs_path):
        return f"File not found: {abs_path}"
    try:
        content = open(abs_path, encoding="utf-8", errors="ignore").read()
    except Exception as e:
        return f"Error reading {abs_path}: {e}"
    lines = content.split("\n")
    issues = []
    # Line count
    if len(lines) > 250:
        issues.append(f"WARN: {len(lines)} lines (target <= 200). Consider extracting a helper.")
    elif len(lines) > 200:
        issues.append(f"NOTE: {len(lines)} lines (target <= 200). Approaching limit.")
    # Check for boundary violations (crossLayer reading conductor directly)
    rel_path = abs_path.replace(PROJECT_ROOT + "/", "")
    if "/crossLayer/" in rel_path:
        direct_reads = ["conductorIntelligence.", "conductorState.", "systemDynamicsProfiler."]
        for dr in direct_reads:
            if dr in content and "conductorSignalBridge" not in content:
                issues.append(f"BOUNDARY: Uses '{dr}' without conductorSignalBridge. Route through bridge.")
    # Coupling firewall: .couplingMatrix reads only allowed in coupling engine, meta-controllers, profiler, diagnostics, pipeline
    if ".couplingMatrix" in content:
        allowed_paths = ["/conductor/signal/balancing/", "/conductor/signal/meta/", "/conductor/signal/profiling/",
                         "/conductor/conductorDiagnostics", "/scripts/pipeline/", "/writer/"]
        if not any(ap in rel_path for ap in allowed_paths):
            issues.append(f"COUPLING FIREWALL: reads .couplingMatrix directly. Only allowed in coupling engine, meta-controllers, profiler, diagnostics.")
    # Check for Object.freeze that should use deepFreeze
    import re as _re
    if "(function deepFreeze" in content or "(function deepFreezeObj" in content:
        issues.append("DRY: Inline deepFreeze implementation. Use shared deepFreeze() from src/utils/deepFreeze.js.")
    # Check for inline layer switching (exclude the definition file itself)
    if "=== 'L1' ? 'L2' : 'L1'" in content and "crossLayerHelpers" not in os.path.basename(abs_path):
        issues.append("DRY: Inline layer switch. Use crossLayerHelpers.getOtherLayer().")
    # Check for validator stamp
    if "validator.create(" in content:
        fname = os.path.basename(abs_path).replace(".js", "")
        stamp_match = _re.search(r"validator\.create\(['\"](\w+)['\"]\)", content)
        if stamp_match and stamp_match.group(1) != fname:
            issues.append(f"CONVENTION: Validator stamp '{stamp_match.group(1)}' doesn't match filename '{fname}'.")
    # Knowledge check
    module_name = os.path.basename(abs_path).replace(".js", "")
    kb_results = project_engine.search_knowledge(module_name, top_k=2)
    constraints = kb_results
    if constraints:
        issues.append(f"KB: {len(constraints)} knowledge entry/entries mention this module:")
        for k in constraints:
            issues.append(f"  [{k['category']}] {k['title']}")
    # Bayesian pattern confidence: how does this file compare to codebase norms?
    if rel_path.startswith("src/") and rel_path.endswith(".js"):
        from file_walker import walk_code_files
        sample_lines = []
        for sfp in walk_code_files(PROJECT_ROOT):
            srel = str(sfp).replace(PROJECT_ROOT + "/", "")
            if not srel.startswith("src/") or not srel.endswith(".js"):
                continue
            try:
                sample_lines.append(sum(1 for _ in open(sfp, encoding="utf-8", errors="ignore")))
            except Exception:
                continue
        if sample_lines:
            import statistics
            median = statistics.median(sample_lines)
            stddev = statistics.stdev(sample_lines) if len(sample_lines) > 1 else 0
            z_score = (len(lines) - median) / max(stddev, 1)
            if z_score > 2.0:
                issues.append(f"OUTLIER: {len(lines)} lines is {z_score:.1f} std devs above median ({median:.0f}). Top {100 * (1 - min(1, len([l for l in sample_lines if l >= len(lines)]) / len(sample_lines))):.0f}% largest.")
            elif z_score < -1.5:
                issues.append(f"NOTE: {len(lines)} lines is unusually small ({z_score:.1f} std devs below median {median:.0f}).")

    if not issues:
        return f"CLEAN: {rel_path} ({len(lines)} lines) - no convention issues found."
    return f"REVIEW: {rel_path} ({len(lines)} lines)\n" + "\n".join(f"  - {i}" for i in issues)


@mcp.tool()
def before_editing(file_path: str) -> str:
    """Call BEFORE editing any file. Assembles everything you need to know: KB constraints, callers, boundary rules, recent changes, and danger zones. One call replaces the entire pre-edit research workflow."""
    budget = _get_context_budget()
    limits = _BUDGET_LIMITS[budget]
    expanded = os.path.expanduser(file_path)
    abs_path = expanded if os.path.isabs(expanded) else os.path.join(PROJECT_ROOT, expanded)
    rel_path = abs_path.replace(PROJECT_ROOT + "/", "")
    module_name = os.path.basename(abs_path).replace(".js", "").replace(".ts", "")
    parts = [f"# Before Editing: {rel_path} (context: {budget})\n"]

    # 1. KB constraints — keep all results since cross-encoder scores aren't 0-1 bounded
    kb_results = project_engine.search_knowledge(module_name, top_k=limits["kb_entries"])
    relevant_kb = kb_results
    if relevant_kb:
        parts.append(f"## KB Constraints ({len(relevant_kb)} entries)")
        for k in relevant_kb:
            parts.append(f"  **[{k['category']}] {k['title']}**")
            parts.append(f"  {k['content'][:limits['kb_content']]}")
            parts.append("")
    else:
        parts.append("## KB Constraints: none found\n")

    # 2. Who depends on this?
    callers = _find_callers(module_name, PROJECT_ROOT)
    callers = [r for r in callers if module_name not in os.path.basename(r.get('file', ''))]
    caller_files = sorted(set(r['file'].replace(PROJECT_ROOT + '/', '') for r in callers))
    caller_limit = limits["callers"]
    parts.append(f"## Dependents ({len(caller_files)} files)")
    for f in caller_files[:caller_limit]:
        parts.append(f"  {f}")
    if len(caller_files) > caller_limit:
        parts.append(f"  ... and {len(caller_files) - caller_limit} more")
    parts.append("")

    # 3. Convention check
    try:
        content = open(abs_path, encoding="utf-8", errors="ignore").read()
        lines = content.split("\n")
        warnings = []
        if len(lines) > 250:
            warnings.append(f"OVERSIZE: {len(lines)} lines (target 200)")
        if "/crossLayer/" in rel_path:
            for dr in ["conductorIntelligence.", "conductorState.", "systemDynamicsProfiler."]:
                if dr in content and "conductorSignalBridge" not in content:
                    warnings.append(f"BOUNDARY VIOLATION: uses '{dr}' without conductorSignalBridge")
        if "(function deepFreeze" in content:
            warnings.append("DRY: inline deepFreeze (use shared utility)")
        if "=== 'L1' ? 'L2' : 'L1'" in content:
            warnings.append("DRY: inline layer switch (use getOtherLayer)")
        if warnings:
            parts.append("## Warnings")
            for w in warnings:
                parts.append(f"  - {w}")
        else:
            parts.append("## Warnings: none")
    except Exception:
        parts.append("## Warnings: file unreadable")

    # 4. File summary
    result = _file_summary(abs_path)
    if not result.get("error"):
        sym_limit = limits["symbols"]
        parts.append(f"\n## Structure ({result.get('lines', '?')} lines)")
        if result.get("symbols"):
            for s in result["symbols"][:sym_limit]:
                sig = f" {s['signature']}" if s.get('signature') else ""
                parts.append(f"  L{s['line']}: [{s['kind']}] {s['name']}{sig}")
            if len(result["symbols"]) > sym_limit:
                parts.append(f"  ... and {len(result['symbols']) - sym_limit} more symbols")

    return "\n".join(parts)


@mcp.tool()
def what_did_i_forget(changed_files: str) -> str:
    """Call AFTER implementing changes, BEFORE running pipeline. Takes comma-separated file paths. Checks changed files against KB for missed constraints, boundary violations, and doc update needs. Output scales with remaining context window."""
    budget = _get_context_budget()
    limits = _BUDGET_LIMITS[budget]
    files = [f.strip() for f in changed_files.split(",") if f.strip()]
    if not files:
        return "No files specified. Pass comma-separated paths."
    parts = [f"# Post-Change Audit (context: {budget})\n"]
    all_warnings = []
    doc_updates_needed = set()
    for file_path in files:
        abs_path = file_path if os.path.isabs(file_path) else os.path.join(PROJECT_ROOT, file_path)
        rel_path = abs_path.replace(PROJECT_ROOT + "/", "")
        module_name = os.path.basename(abs_path).replace(".js", "").replace(".ts", "")
        # Check KB for constraints on this module
        kb_results = project_engine.search_knowledge(module_name, top_k=limits["kb_entries"])
        for k in kb_results:
            all_warnings.append(f"[{rel_path}] KB constraint: [{k['category']}] {k['title']}")
        # Check if crossLayer file touches conductor
        try:
            content = open(abs_path, encoding="utf-8", errors="ignore").read()
            if "/crossLayer/" in rel_path:
                for dr in ["systemDynamicsProfiler.", "pipelineCouplingManager.", "conductorState."]:
                    if dr in content and "conductorSignalBridge" not in content:
                        all_warnings.append(f"[{rel_path}] BOUNDARY: uses {dr} directly")
            # Check if new L0 channel was added (JS files only)
            if rel_path.endswith(".js") and "L0.post('" in content:
                import re
                channels = set(re.findall(r"L0\.post\('([^']+)'", content))
                for ch in channels:
                    if ch not in ('onset', 'note', 'harmonic', 'entropy', 'coherence', 'feedbackPitch',
                                  'regimeTransition', 'rhythm', 'tickDuration', 'feedbackLoop',
                                  'motifIdentity', 'phase', 'spectral', 'articulation', 'grooveTransfer',
                                  'registerCollision', 'convergence-density', 'climax-pressure',
                                  'rest-sync', 'density-rhythm', 'section-quality', 'emissionDelta',
                                  'perceptual-crowding', 'harmonic-journey-eval', 'emissionSummary',
                                  'phaseConvergence', 'explainability'):
                        all_warnings.append(f"[{rel_path}] NEW L0 CHANNEL: '{ch}' -- add to narrative-digest and trace-summary consumers")
        except Exception:
            pass
        # Track doc update needs
        if "src/conductor/" in rel_path:
            doc_updates_needed.add("doc/ARCHITECTURE.md (conductor changes)")
        if "src/crossLayer/" in rel_path:
            doc_updates_needed.add("doc/ARCHITECTURE.md (cross-layer changes)")
        if "src/utils/" in rel_path:
            doc_updates_needed.add("CLAUDE.md (new utility)")
        if "src/time/" in rel_path:
            doc_updates_needed.add("doc/ARCHITECTURE.md (timing changes)")

    if all_warnings:
        parts.append(f"## Warnings ({len(all_warnings)})")
        for w in all_warnings:
            parts.append(f"  - {w}")
    else:
        parts.append("## Warnings: none found")
    if doc_updates_needed:
        parts.append(f"\n## Docs to Update")
        for d in sorted(doc_updates_needed):
            parts.append(f"  - {d}")
    parts.append(f"\n## Reminders")
    parts.append("  - index_codebase after running pipeline")
    parts.append("  - add_knowledge for any new calibration anchors or decisions")
    return "\n".join(parts)


@mcp.tool()
def module_story(module_name: str) -> str:
    """Tell the story of a module: definition, evolution history from KB, callers, conventions, and current health. A living biography. Output is automatically scaled based on remaining context window — greedy when context is plentiful, minimal when tight."""
    budget = _get_context_budget()
    limits = _BUDGET_LIMITS[budget]
    parts = [f"# Module Story: {module_name} (context: {budget})\n"]
    # Definition — try exact symbol match, then prefix match, then file search
    syms = collect_all_symbols(PROJECT_ROOT)
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
        candidates = _glob.glob(os.path.join(PROJECT_ROOT, "src", "**", f"{module_name}.js"), recursive=True)
        if candidates:
            matching = [{"name": module_name, "kind": "module", "file": candidates[0], "line": 1, "signature": ""}]
    if matching:
        s = matching[0]
        parts.append(f"## Definition")
        parts.append(f"  {s['file'].replace(PROJECT_ROOT + '/', '')}:{s['line']} [{s['kind']}]")
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
    # Evolution history from KB
    kb_limit = limits["kb_entries"] * 2  # module_story should show more history
    kb_results = project_engine.search_knowledge(module_name, top_k=kb_limit)
    relevant = kb_results
    if relevant:
        parts.append(f"## Evolution History ({len(relevant)} KB entries)")
        for k in relevant:
            parts.append(f"  **[{k['category']}] {k['title']}**")
            parts.append(f"  {k['content'][:limits['kb_content']]}...")
            parts.append("")
    else:
        parts.append("## Evolution History: no KB entries mention this module\n")
    # Callers
    callers = _find_callers(module_name, PROJECT_ROOT)
    callers = [r for r in callers if module_name not in os.path.basename(r.get('file', ''))]
    caller_files = sorted(set(r['file'].replace(PROJECT_ROOT + '/', '') for r in callers))
    caller_limit = limits["callers"]
    parts.append(f"## Dependents ({len(caller_files)} files)")
    for f in caller_files[:caller_limit]:
        parts.append(f"  {f}")
    if len(caller_files) > caller_limit:
        parts.append(f"  ... and {len(caller_files) - caller_limit} more")
    # Semantic neighbors
    sim_limit = limits["similar"]
    if matching and sim_limit > 0:
        try:
            content = open(matching[0]["file"], encoding="utf-8", errors="ignore").read()[:500]
            similar = _find_similar(content, project_engine, top_k=sim_limit)
            if similar:
                parts.append(f"\n## Similar Modules")
                for r in similar:
                    parts.append(f"  {r['source'].replace(PROJECT_ROOT + '/', '')} ({r['score']:.0%})")
        except Exception:
            pass
    return "\n".join(parts)


@mcp.tool()
def diagnose_error(error_text: str) -> str:
    """Paste a pipeline error. Returns: likely source file, relevant KB entries, similar past bugs, and fix patterns."""
    parts = ["# Error Diagnosis\n"]
    # Extract symbol/file references from error text
    import re
    file_refs = re.findall(r'(/home/[^\s:)]+\.js):?(\d+)?', error_text)
    symbol_refs = re.findall(r'\b([a-z][a-zA-Z]{5,})\b', error_text)
    error_type = re.search(r'(TypeError|ReferenceError|Error|RangeError):\s*(.+?)(?:\n|$)', error_text)
    if error_type:
        parts.append(f"## Error: {error_type.group(1)}: {error_type.group(2)[:100]}")
    if file_refs:
        parts.append(f"\n## Source Files")
        for fpath, line in file_refs[:5]:
            rel = fpath.replace(PROJECT_ROOT + '/', '')
            parts.append(f"  {rel}" + (f":{line}" if line else ""))
    # Search KB for similar bugs — by error message AND by module names from stack
    kb_query = error_type.group(2)[:60] if error_type else error_text[:80]
    kb_results = project_engine.search_knowledge(kb_query, top_k=5)
    # Also search by module names from file refs for broader matches
    for fpath, _ in file_refs[:3]:
        module = os.path.basename(fpath).replace('.js', '').replace('.ts', '')
        module_kb = project_engine.search_knowledge(module, top_k=2)
        kb_results.extend([k for k in module_kb if k["id"] not in {r["id"] for r in kb_results}])
    bugfixes = [k for k in kb_results if k["category"] == "bugfix"]
    patterns = [k for k in kb_results if k["category"] == "pattern"]
    if bugfixes:
        parts.append(f"\n## Similar Past Bugs ({len(bugfixes)})")
        for k in bugfixes:
            parts.append(f"  **{k['title']}**")
            parts.append(f"  {k['content'][:180]}")
            parts.append("")
    if patterns:
        parts.append(f"\n## Related Patterns ({len(patterns)})")
        for k in patterns:
            parts.append(f"  **{k['title']}**")
            parts.append(f"  {k['content'][:150]}")
            parts.append("")
    # Symbol context
    unique_symbols = list(set(symbol_refs))[:5]
    for sym in unique_symbols:
        callers = _find_callers(sym, PROJECT_ROOT)
        if 1 <= len(callers) <= 20:
            parts.append(f"\n## '{sym}' appears in {len(callers)} locations")
            for r in callers[:3]:
                parts.append(f"  {r['file'].replace(PROJECT_ROOT + '/', '')}:{r['line']}")
    if not file_refs and not bugfixes and not unique_symbols:
        parts.append("\nNo specific diagnosis available. Try search_knowledge with key terms from the error.")
    return "\n".join(parts)


@mcp.tool()
def codebase_health() -> str:
    """Full-repo convention sweep. Returns prioritized report of all files with issues."""
    from file_walker import walk_code_files
    issues_by_severity = {"CRITICAL": [], "WARN": [], "NOTE": []}
    file_count = 0
    for fpath in walk_code_files(PROJECT_ROOT):
        rel = str(fpath).replace(PROJECT_ROOT + "/", "")
        if not rel.startswith("src/"):
            continue
        file_count += 1
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        lines = content.split("\n")
        line_count = len(lines)
        if line_count > 300:
            issues_by_severity["CRITICAL"].append(f"{rel}: {line_count} lines (target 200)")
        elif line_count > 250:
            issues_by_severity["WARN"].append(f"{rel}: {line_count} lines")
        if "/crossLayer/" in rel:
            for dr in ["conductorIntelligence.", "conductorState.", "systemDynamicsProfiler."]:
                if dr in content and "conductorSignalBridge" not in content:
                    issues_by_severity["CRITICAL"].append(f"{rel}: boundary violation ({dr})")
                    break
        if "(function deepFreeze" in content or "(function deepFreezeObj" in content:
            issues_by_severity["WARN"].append(f"{rel}: inline deepFreeze (use shared utility)")
        # Coupling firewall
        if ".couplingMatrix" in content:
            allowed = ["/conductor/signal/balancing/", "/conductor/signal/meta/", "/conductor/signal/profiling/",
                       "/conductor/conductorDiagnostics", "/scripts/pipeline/", "/writer/"]
            if not any(a in rel for a in allowed):
                issues_by_severity["WARN"].append(f"{rel}: coupling firewall violation (.couplingMatrix)")
        if "=== 'L1' ? 'L2' : 'L1'" in content:
            issues_by_severity["NOTE"].append(f"{rel}: inline layer switch")
    parts = [f"# Codebase Health Report ({file_count} src/ files)\n"]
    total = sum(len(v) for v in issues_by_severity.values())
    if total == 0:
        parts.append("ALL CLEAN. No convention issues found.")
        return "\n".join(parts)
    for sev in ["CRITICAL", "WARN", "NOTE"]:
        items = issues_by_severity[sev]
        if items:
            parts.append(f"## {sev} ({len(items)})")
            for item in sorted(items):
                parts.append(f"  - {item}")
            parts.append("")
    parts.append(f"Total: {total} issues across {file_count} files")
    return "\n".join(parts)


@mcp.tool()
def find_dead_code(path: str = "src") -> str:
    """Scan all IIFE globals for zero external callers (dormant modules). Wraps find_callers into a sweep."""
    from file_walker import walk_code_files
    import re as _re
    target = os.path.join(PROJECT_ROOT, path) if not os.path.isabs(path) else path
    iife_re = _re.compile(r'^(\w+)\s*=\s*\(\s*\(', _re.MULTILINE)
    dormant = []
    active = []
    for fpath in walk_code_files(target):
        if not str(fpath).endswith('.js'):
            continue
        try:
            content = fpath.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        for m in iife_re.finditer(content):
            name = m.group(1)
            if name in ('if', 'else', 'for', 'while', 'return'):
                continue
            callers = _find_callers(name, PROJECT_ROOT)
            # Exclude self-references (same file)
            external = [c for c in callers if os.path.basename(c['file']) != os.path.basename(str(fpath))]
            if not external:
                rel = str(fpath).replace(PROJECT_ROOT + '/', '')
                dormant.append(f"  {name} ({rel}) -- 0 external callers")
            else:
                active.append(name)
    if not dormant:
        return f"No dead code found. All {len(active)} IIFE globals have external callers."
    parts = [f"# Dead Code Report ({len(dormant)} dormant globals)\n"]
    for d in sorted(dormant):
        parts.append(d)
    parts.append(f"\n{len(active)} active globals OK")
    return "\n".join(parts)


@mcp.tool()
def symbol_importance(top_n: int = 20) -> str:
    """Rank IIFE globals by caller count (architectural centrality). Most-called = most important."""
    from file_walker import walk_code_files
    import re as _re
    iife_re = _re.compile(r'^(\w+)\s*=\s*\(\s*\(', _re.MULTILINE)
    symbols = []
    for fpath in walk_code_files(os.path.join(PROJECT_ROOT, 'src')):
        if not str(fpath).endswith('.js'):
            continue
        try:
            content = fpath.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        for m in iife_re.finditer(content):
            name = m.group(1)
            if name in ('if', 'else', 'for', 'while', 'return'):
                continue
            callers = _find_callers(name, PROJECT_ROOT)
            external = [c for c in callers if os.path.basename(c['file']) != os.path.basename(str(fpath))]
            rel = str(fpath).replace(PROJECT_ROOT + '/', '')
            symbols.append((len(external), name, rel))
    symbols.sort(key=lambda x: -x[0])
    parts = [f"# Symbol Importance (top {top_n} by caller count)\n"]
    for i, (count, name, rel) in enumerate(symbols[:top_n]):
        parts.append(f"  {i+1}. {name}: {count} callers ({rel})")
    if len(symbols) > top_n:
        parts.append(f"\n  ... {len(symbols) - top_n} more symbols")
    parts.append(f"\nTotal: {len(symbols)} IIFE globals scanned")
    return "\n".join(parts)


@mcp.tool()
def memory_dream() -> str:
    """Consolidation pass: replay all KB entries, discover hidden connections via pairwise similarity. Inspired by Vestige's memory dreaming."""
    rows = project_engine.list_knowledge_full()
    if len(rows) < 2:
        return "Not enough KB entries to dream (need 2+)."
    # Compute embeddings for all entries
    texts = [f"{r['title']} {r['content']}" for r in rows]
    vecs = shared_model.encode(texts)
    # Find high-similarity pairs that aren't already linked
    import numpy as np
    discoveries = []
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            sim = float(np.dot(vecs[i], vecs[j]) / (np.linalg.norm(vecs[i]) * np.linalg.norm(vecs[j]) + 1e-10))
            if sim > 0.65:
                # Check if already linked
                tags_i = rows[i].get("tags", "")
                tags_j = rows[j].get("tags", "")
                already_linked = rows[j]["id"] in tags_i or rows[i]["id"] in tags_j
                if not already_linked:
                    discoveries.append((sim, rows[i]["title"], rows[j]["title"], rows[i]["id"], rows[j]["id"]))
    discoveries.sort(key=lambda x: -x[0])
    if not discoveries:
        return f"Memory dream complete: {len(rows)} entries, no hidden connections found (all similarities < 0.65)."
    parts = [f"# Memory Dream ({len(rows)} entries, {len(discoveries)} hidden connections)\n"]
    for sim, title_a, title_b, id_a, id_b in discoveries[:10]:
        parts.append(f"  {sim:.0%} similarity:")
        parts.append(f"    [{id_a[:8]}] {title_a}")
        parts.append(f"    [{id_b[:8]}] {title_b}")
        parts.append(f"    -> Consider: add_knowledge related_to=\"{id_b}\" relation_type=\"similar_to\"")
        parts.append("")
    return "\n".join(parts)


@mcp.tool()
def knowledge_graph(query: str) -> str:
    """Search knowledge with spreading activation: matches entry A, then traverses A's relationships to find connected entries. Multi-hop discovery."""
    results = project_engine.search_knowledge(query, top_k=8)
    if not results:
        return "No knowledge entries match this query."
    # Spreading activation: for each result, also fetch entries it links to
    activated = []
    seen_ids = {r["id"] for r in results}
    for r in results:
        tags = r.get("tags", [])
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        for tag in tags:
            # Extract linked entry IDs from typed relationships (e.g., "caused_by:abc123")
            linked_id = tag.split(":")[-1] if ":" in tag else tag
            if len(linked_id) == 12 and linked_id not in seen_ids:
                # Fetch the linked entry by searching for its ID
                linked = project_engine.search_knowledge(linked_id, top_k=1)
                for lk in linked:
                    if lk["id"] not in seen_ids:
                        activated.append(lk)
                        seen_ids.add(lk["id"])
    results = results + activated
    parts = [f"# Knowledge Graph: '{query}' ({len(results)} entries, {len(activated)} via activation)\n"]
    # Build adjacency from tags
    entries = {r["id"]: r for r in results}
    connections = []
    for r in results:
        tags = r.get("tags", [])
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        for tag in tags:
            # Check for typed relationship: "relation_type:entry_id"
            if ":" in tag and tag.split(":")[1] in entries:
                rel_type, rel_id = tag.split(":", 1)
                connections.append((r["id"], rel_id, rel_type))
            elif tag in entries:
                connections.append((r["id"], tag, "related_to"))
            else:
                for other in results:
                    if other["id"] != r["id"]:
                        if tag.lower() in other["title"].lower() or tag.lower() in other["content"].lower()[:100]:
                            connections.append((r["id"], other["id"], f"shared: {tag}"))
    # Render entries
    parts.append(f"## Entries ({len(results)})")
    for r in results:
        score_pct = f"{r['score']:.0%}" if isinstance(r.get('score'), (int, float)) else '?'
        parts.append(f"  [{r['id'][:8]}] **[{r['category']}] {r['title']}** ({score_pct})")
        parts.append(f"    {r['content'][:120]}...")
        parts.append("")
    # Render connections
    seen = set()
    unique_connections = []
    for a, b, reason in connections:
        key = tuple(sorted([a, b])) + (reason,)
        if key not in seen:
            seen.add(key)
            unique_connections.append((a, b, reason))
    if unique_connections:
        parts.append(f"## Connections ({len(unique_connections)})")
        for a, b, reason in unique_connections:
            a_title = entries.get(a, {}).get("title", a[:8])
            b_title = entries.get(b, {}).get("title", b[:8])
            parts.append(f"  {a_title[:40]} <-> {b_title[:40]} ({reason})")
    else:
        parts.append("## Connections: none detected (use related_to when adding knowledge to create links)")
    # Combined implications
    categories = set(r["category"] for r in results)
    if "bugfix" in categories and "pattern" in categories:
        parts.append(f"\n## Implication: bugfix + pattern entries both match -- check if the fix addresses the pattern root cause")
    if "decision" in categories and "architecture" in categories:
        parts.append(f"\n## Implication: decision + architecture entries both match -- verify the decision respects the architectural boundary")
    return "\n".join(parts)


@mcp.tool()
def kb_health() -> str:
    """Check all KB entries for staleness: do the files/modules they mention still exist? Are line counts accurate?"""
    import re
    rows = project_engine.list_knowledge_full()
    if not rows:
        return "KB is empty."
    parts = ["# KB Health Report\n"]
    stale = []
    healthy = []
    for entry in rows:
        title = entry.get("title", "")
        content = entry.get("content", "")
        entry_id = entry.get("id", "?")[:8]
        issues = []
        # Check for file references
        file_refs = re.findall(r'(src/[\w/]+\.js)', content)
        for fref in file_refs:
            abs_path = os.path.join(PROJECT_ROOT, fref)
            if not os.path.isfile(abs_path):
                issues.append(f"references {fref} which no longer exists")
            else:
                lines = sum(1 for _ in open(abs_path, encoding="utf-8", errors="ignore"))
                # Check if entry mentions a line count
                line_match = re.search(r'(\d{3,})\s*lines', content)
                if line_match:
                    claimed = int(line_match.group(1))
                    if abs(claimed - lines) > 20:
                        issues.append(f"claims {claimed} lines for {fref}, actual {lines}")
        # Check age
        ts = entry.get("timestamp", 0)
        if ts > 0:
            age_days = (time.time() - ts) / 86400
            if age_days > 30:
                issues.append(f"entry is {age_days:.0f} days old")
        if issues:
            stale.append(f"  [{entry_id}] {title}: {'; '.join(issues)}")
        else:
            healthy.append(entry_id)
    if stale:
        parts.append(f"## Stale ({len(stale)} entries)")
        for s in stale:
            parts.append(s)
    parts.append(f"\n## Healthy: {len(healthy)} entries")
    return "\n".join(parts)


@mcp.tool()
def doc_sync_check(doc_path: str = "") -> str:
    """Check if a doc file is in sync with the codebase it describes. Finds stale references, missing tools, outdated counts."""
    target = doc_path if doc_path else os.path.join(PROJECT_ROOT, "doc/code-docs-rag.md")
    abs_target = target if os.path.isabs(target) else os.path.join(PROJECT_ROOT, target)
    if not os.path.isfile(abs_target):
        return f"File not found: {abs_target}"
    doc_content = open(abs_target, encoding="utf-8", errors="ignore").read()
    issues = []
    # Check tool count claim
    import re
    count_match = re.search(r'(\d+)\s+(?:MCP\s+)?tools', doc_content)
    actual_tools = sum(1 for line in open(os.path.join(os.path.dirname(__file__), "server.py")).readlines() if line.strip().startswith("@mcp.tool"))
    if count_match:
        claimed = int(count_match.group(1))
        if claimed != actual_tools:
            issues.append(f"STALE: doc claims {claimed} tools, server has {actual_tools}")
    # Check file/chunk/symbol counts
    stats_match = re.search(r'Files:\s*(\d+)', doc_content)
    if stats_match:
        claimed_files = int(stats_match.group(1))
        from file_walker import walk_code_files
        actual_files = sum(1 for _ in walk_code_files(PROJECT_ROOT))
        if abs(claimed_files - actual_files) > 10:
            issues.append(f"STALE: doc claims {claimed_files} files, actual {actual_files}")
    # Check for tool names in doc that don't exist in server
    server_content = open(os.path.join(os.path.dirname(__file__), "server.py"), encoding="utf-8").read()
    doc_tool_refs = set(re.findall(r'`(\w{4,})`', doc_content))
    server_fns = set(re.findall(r'def (\w+)\(', server_content))
    # Only flag tools that look like they should be server functions
    tool_like = {t for t in doc_tool_refs if t.islower() and '_' in t and t not in server_fns and len(t) > 6}
    if tool_like:
        issues.append(f"MISSING: doc references tools not in server: {', '.join(sorted(tool_like))}")
    if not issues:
        return f"IN SYNC: {os.path.basename(abs_target)} matches server ({actual_tools} tools)"
    return f"OUT OF SYNC: {os.path.basename(abs_target)}\n" + "\n".join(f"  - {i}" for i in issues)


@mcp.tool()
def think(about: str, context: str = "") -> str:
    """Structured reflection tool. Forces the agent to pause and reason about a specific concern before proceeding. Inspired by Serena MCP's thinking workflow."""
    prompts = {
        "task_adherence": "Am I still working on what the user asked? Have I drifted into tangential work? What was the original request and am I addressing it?",
        "completeness": "Have I finished everything required? Are there skipped phases (verify, journal, snapshot)? Did I check the pipeline results? Did I update docs?",
        "constraints": "What KB constraints apply to what I'm about to do? Have I called before_editing? Are there boundary rules I might violate?",
        "impact": "What could break from my changes? Have I checked callers? Are there compound effects with other recent changes?",
        "conventions": "Does my code follow project conventions? Line count? Naming? Registration? Architectural boundaries?",
    }
    prompt = prompts.get(about, f"Reflect on: {about}")
    parts = [f"# Think: {about}\n"]
    parts.append(f"**Prompt:** {prompt}\n")
    if context:
        parts.append(f"**Context:** {context}\n")
    # Auto-inject relevant KB
    kb_hits = project_engine.search_knowledge(about, top_k=3)
    relevant = kb_hits
    if relevant:
        parts.append("**Relevant KB:**")
        for k in relevant:
            parts.append(f"  [{k['category']}] {k['title']}: {k['content'][:100]}...")
    parts.append("\n**Now reflect and respond before proceeding.**")
    return "\n".join(parts)


@mcp.tool()
def blast_radius(symbol_name: str, max_depth: int = 3) -> str:
    """Trace the full transitive dependency chain of a symbol: who calls it, who calls those callers, etc. Deeper than impact_analysis."""
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
            callers = _find_callers(sym, PROJECT_ROOT)
            for r in callers:
                caller_file = os.path.basename(r["file"]).replace(".js", "").replace(".ts", "")
                if caller_file not in visited and caller_file != sym:
                    next_layer.append(caller_file)
                    layer_results.append(f"  {r['file'].replace(PROJECT_ROOT + '/', '')}:{r['line']} ({sym})")
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
    kb_hits = project_engine.search_knowledge(symbol_name, top_k=2)
    relevant = [k for k in kb_hits if k["score"] > 0.2]
    if relevant:
        parts.append("## KB Constraints")
        for k in relevant:
            parts.append(f"  [{k['category']}] {k['title']}")
    parts.append(f"\nTotal blast radius: {total} sites across {len(layers)} depth levels")
    all_files = set()
    for _, results in layers:
        for r in results:
            f = r.strip().split(":")[0]
            all_files.add(f)
    parts.append(f"Files affected: {len(all_files)}")
    return "\n".join(parts)


@mcp.tool()
def type_hierarchy(type_name: str = "") -> str:
    """Show the class/interface inheritance hierarchy. With no arguments, shows all root types and their subtypes. With type_name, shows the specific type's extends/implements relationships and who extends/implements it. Useful for understanding polymorphism and interface contracts in the codebase."""
    result = _get_type_hierarchy(PROJECT_ROOT)
    types = result["types"]

    if not types:
        return "No type hierarchy found. Make sure project has classes/structs/traits."

    if type_name:
        if type_name not in types:
            matches = [n for n in types if type_name.lower() in n.lower()]
            if not matches:
                return f"Type '{type_name}' not found."
            parts = [f"Partial matches for '{type_name}':"]
            for m in matches[:20]:
                t = types[m]
                parts.append(f"  [{t['kind']}] {m} ({t['file']}:{t['line']})")
            return "\n".join(parts)

        t = types[type_name]
        parts = [f"[{t['kind']}] {type_name} ({t['file']}:{t['line']})"]
        if t["extends"]:
            parts.append(f"  extends: {', '.join(t['extends'])}")
        if t["implements"]:
            parts.append(f"  implements: {', '.join(t['implements'])}")
        if t["extended_by"]:
            parts.append(f"  extended by: {', '.join(t['extended_by'])}")
        if t["implemented_by"]:
            parts.append(f"  implemented by: {', '.join(t['implemented_by'])}")
        return "\n".join(parts)

    roots = [n for n, t in types.items() if not t["extends"] and (t["extended_by"] or t["implemented_by"])]
    parts = [f"Type hierarchy: {len(types)} types, {len(result['edges'])} edges"]

    for r in sorted(roots)[:50]:
        t = types[r]
        parts.append(f"\n[{t['kind']}] {r}")
        for child in t.get("extended_by", []):
            parts.append(f"  <- {child} (extends)")
        for child in t.get("implemented_by", []):
            parts.append(f"  <- {child} (implements)")

    return "\n".join(parts)


@mcp.tool()
def cross_language_trace(symbol_name: str) -> str:
    """Trace a symbol across language boundaries: Rust definition, WASM bridge, and TypeScript/JavaScript callers. Reconstructs the full call chain from native code through FFI to the JS runtime. Useful for understanding cross-language dependencies and WASM integration points."""
    result = _trace_cross_lang(symbol_name, PROJECT_ROOT)

    parts = [f"Cross-language trace for '{symbol_name}':"]

    if result["rust_definition"]:
        rd = result["rust_definition"]
        wasm_tag = " [wasm_bindgen]" if rd["is_wasm_export"] else ""
        parts.append(f"\nRust definition: {rd['file']}:{rd['line']}{wasm_tag}")
    else:
        parts.append("\nRust definition: not found")

    if result["wasm_bridge"]:
        parts.append(f"\nWASM bridge ({len(result['wasm_bridge'])}):")
        for br in result["wasm_bridge"][:10]:
            parts.append(f"  {br['file']}:{br['line']} - {br['text'][:100]}")

    if result["ts_callers"]:
        parts.append(f"\nTS callers ({len(result['ts_callers'])}):")
        for tc in result["ts_callers"][:20]:
            parts.append(f"  {tc['file']}:{tc['line']} - {tc['text'][:100]}")

    if result["chain"]:
        parts.append(f"\nCall chain:\n  " + "\n  -> ".join(result["chain"]))

    return "\n".join(parts)




@mcp.tool()
def bulk_rename_preview(old_name: str, new_name: str, language: str = "") -> str:
    """Preview what a symbol rename would change across the codebase WITHOUT making any modifications. Shows each occurrence categorized by type (definition, reference, import, string, comment) and whether it would be renamed or skipped. Use to assess rename safety and scope before committing to a refactor."""
    results = _preview_rename(old_name, new_name, PROJECT_ROOT, language=language)
    if not results:
        return f"No occurrences of '{old_name}' found."

    would_rename = [r for r in results if r["would_rename"]]
    would_skip = [r for r in results if not r["would_rename"]]

    by_cat: dict[str, list] = {}
    for r in would_rename:
        by_cat.setdefault(r["category"], []).append(r)

    parts = [f"Rename '{old_name}' -> '{new_name}': {len(would_rename)} locations to rename, {len(would_skip)} to skip"]

    for cat, entries in sorted(by_cat.items()):
        parts.append(f"\n[{cat}] ({len(entries)})")
        for e in entries[:20]:
            parts.append(f"  {e['file']}:{e['line']}:{e['column']} - {e['text'][:100]}")
        if len(entries) > 20:
            parts.append(f"  ... and {len(entries) - 20} more")

    if would_skip:
        parts.append(f"\nSkipped ({len(would_skip)}, in strings/comments):")
        for e in would_skip[:10]:
            parts.append(f"  {e['file']}:{e['line']} [{e['category']}] - {e['text'][:80]}")

    return "\n".join(parts)


@mcp.tool()
def get_function_body(function_name: str, file_path: str = "", language: str = "") -> str:
    """Extract the complete source code of a named function. If file_path is given, searches only that file. Otherwise, looks up the function in the symbol index and extracts from the first matching file(s). Returns the function body with line numbers and kind (function, method, etc). Useful for reading a specific function without loading the entire file."""
    from chunker import get_function_body as _get_body

    if file_path:
        abs_path = file_path if os.path.isabs(file_path) else os.path.join(PROJECT_ROOT, file_path)
        if not os.path.isfile(abs_path):
            return f"File not found: {abs_path}"
        try:
            content = open(abs_path, encoding="utf-8", errors="ignore").read()
        except Exception as e:
            return f"Error reading file: {e}"
        lang = language if language else ext_to_lang(os.path.splitext(abs_path)[1])
        result = _get_body(content, lang, function_name)
        if result:
            return f"{abs_path}:{result['start_line']}-{result['end_line']} [{result['kind']}]\n{result['content']}"
        return f"Function '{function_name}' not found in {abs_path}"

    results = project_engine.lookup_symbol(function_name, kind="", language=language)
    if not results:
        return f"Symbol '{function_name}' not found. Try index_symbols first."

    parts = []
    seen = set()
    for sym in results[:5]:
        if sym["file"] in seen:
            continue
        seen.add(sym["file"])
        try:
            content = open(sym["file"], encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        lang = language if language else ext_to_lang(os.path.splitext(sym["file"])[1])
        result = _get_body(content, lang, function_name)
        if result:
            parts.append(f"{sym['file']}:{result['start_line']}-{result['end_line']} [{result['kind']}]\n{result['content']}")

    if not parts:
        locs = [f"  {s['file']}:{s['line']} [{s['kind']}]" for s in results[:5]]
        return f"Found symbol but couldn't extract body:\n" + "\n".join(locs)

    return "\n\n---\n\n".join(parts)


if __name__ == "__main__":
    mcp.run(transport="stdio")

