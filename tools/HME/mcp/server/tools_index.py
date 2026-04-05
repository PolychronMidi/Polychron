"""HME index tools."""
import os
import logging
from concurrent.futures import ThreadPoolExecutor

from server import context as ctx
from server.helpers import (
    get_context_budget, validate_project_path,
    format_knowledge_results, check_path_in_project,
    BUDGET_LIMITS, CROSSLAYER_BOUNDARY_VIOLATIONS,
)
from symbols import collect_all_symbols

logger = logging.getLogger("HME")

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
def recent_changes(since: str = "1 hour ago") -> str:
    """Show recently changed files with KB context. Great after context compaction to recover what was modified."""
    ctx.ensure_ready_sync()
    import subprocess
    try:
        result = subprocess.run(
            ["git", "-C", ctx.PROJECT_ROOT, "diff", "--name-only", "--diff-filter=M"],
            capture_output=True, text=True, timeout=5
        )
        unstaged = [f for f in result.stdout.strip().split("\n") if f.strip()]
    except Exception:
        unstaged = []
    try:
        result = subprocess.run(
            ["git", "-C", ctx.PROJECT_ROOT, "diff", "--cached", "--name-only"],
            capture_output=True, text=True, timeout=5
        )
        staged = [f for f in result.stdout.strip().split("\n") if f.strip()]
    except Exception:
        staged = []
    try:
        result = subprocess.run(
            ["git", "-C", ctx.PROJECT_ROOT, "log", f"--since={since}", "--name-only", "--pretty=format:", "--diff-filter=M"],
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
        kb_hits = ctx.project_engine.search_knowledge(module, top_k=1)
        kb_tag = ""
        if kb_hits:
            kb_tag = f" [KB: {kb_hits[0]['title'][:50]}]"
        parts.append(f"  {f} ({', '.join(status)}){kb_tag}")
    return "\n".join(parts)



@ctx.mcp.tool()
def index_codebase(directory: str = "", lib: str = "") -> str:
    """Reindex all code chunks and symbols for semantic search. Run after batch code changes or when search results seem stale. The file watcher handles individual saves automatically (5s debounce), so this is only needed after bulk operations. Set lib='<name>' to reindex a specific library. With no arguments, reindexes the main project and all configured libraries in parallel. Also rebuilds the symbol index. Returns file/chunk/symbol counts."""
    ctx.ensure_ready_sync()
    if lib:
        resolved = _resolve_lib_engine(lib)
        if not resolved:
            available = ", ".join(ctx.lib_engines.keys()) if ctx.lib_engines else "(none)"
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

    target = directory if directory else ctx.PROJECT_ROOT
    if not os.path.isdir(target):
        return f"Error: directory not found: {target}"

    futures = {}
    with ThreadPoolExecutor(max_workers=max(1, len(ctx.lib_engines) + 1)) as pool:
        futures["__main__"] = pool.submit(_index_main, target)
        for lib_key, engine in ctx.lib_engines.items():
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



@ctx.mcp.tool()
def get_index_status() -> str:
    """Check the health and size of all indexes (main project and libraries). Returns file counts, chunk counts, and symbol counts. Use this to verify indexing completed successfully or to diagnose why search results are missing. If the index shows zero files, run index_codebase to build it."""
    ctx.ensure_ready_sync()
    status = ctx.project_engine.get_status()
    parts = []
    if not status["indexed"]:
        parts.append("Main: No index found. Run index_codebase to create one.")
    else:
        sym_status = ctx.project_engine.get_symbol_status()
        sym_count = sym_status.get("total_symbols", 0) if sym_status.get("indexed") else 0
        parts.append(
            f"Main index:\n"
            f"  Total files: {status['total_files']}\n"
            f"  Total chunks: {status['total_chunks']}\n"
            f"  Total symbols: {sym_count}"
        )

    for lib_key, engine in ctx.lib_engines.items():
        lib_status = engine.get_status()
        if lib_status["indexed"]:
            parts.append(f"Lib '{lib_key}': {lib_status['total_files']} files, {lib_status['total_chunks']} chunks")
        else:
            parts.append(f"Lib '{lib_key}': not indexed")

    return "\n".join(parts)



@ctx.mcp.tool()
def clear_index() -> str:
    """Delete all indexed code chunks AND immediately rebuild from scratch. Atomic: no gap for
    file watcher to repopulate stale hashes. Use when embedding model changed, chunker logic
    changed, or index is corrupted. Does not affect the knowledge base."""
    ctx.ensure_ready_sync()
    ctx.project_engine.clear()
    # Immediately rebuild — atomic, no gap for watcher to repopulate stale cache
    result = _index_main(ctx.PROJECT_ROOT)
    return (
        f"Index cleared and rebuilt: {result['total_files']} files, "
        f"{result['indexed']} indexed, {result['chunks_created']} chunks, "
        f"{result['symbols_indexed']} symbols"
    )



@ctx.mcp.tool()
def list_libs() -> str:
    """Show all configured external library directories and their index status. Libraries are configured via ragLibs in .mcp.json. Returns each library's file count and chunk count if indexed, or indicates whether the directory exists but is unindexed. Use index_codebase with lib='<name>' to index a specific library."""
    ctx.ensure_ready_sync()
    if not ctx.lib_engines:
        return "No external libraries configured. Add ragLibs to .mcp.json to configure."

    parts = [f"Configured libraries ({len(ctx.lib_engines)}):"]
    for lib_key, engine in ctx.lib_engines.items():
        lib_abs = os.path.normpath(os.path.join(ctx.PROJECT_ROOT, lib_key))
        exists = os.path.isdir(lib_abs)
        status = engine.get_status()
        if status["indexed"]:
            parts.append(f"  {lib_key}: {status['total_files']} files, {status['total_chunks']} chunks")
        elif exists:
            parts.append(f"  {lib_key}: not indexed (directory exists)")
        else:
            parts.append(f"  {lib_key}: directory not found ({lib_abs})")

    return "\n".join(parts)



def index_symbols() -> str:
    """Rebuild the symbol index from scratch. Scans all project files for IIFE globals, inner functions, classes, and other named symbols. Usually called automatically by index_codebase, but can be run independently after symbol-focused changes. Returns counts broken down by symbol kind."""
    ctx.ensure_ready_sync()
    symbols = collect_all_symbols(ctx.PROJECT_ROOT)
    result = ctx.project_engine.index_symbols(symbols)
    by_kind: dict[str, int] = {}
    for s in symbols:
        by_kind[s["kind"]] = by_kind.get(s["kind"], 0) + 1
    def _plural(n, word):
        if n == 1:
            return f"{n} {word}"
        return f"{n} {word}es" if word.endswith(("s", "sh", "ch", "x", "z")) else f"{n} {word}s"
    kind_str = ", ".join(_plural(v, k) for k, v in sorted(by_kind.items(), key=lambda x: -x[1]))
    return f"Symbol index built: {result['indexed']} symbols ({kind_str})"

# index_codebase now also rebuilds symbols — reindex() just provides a cleaner API
@ctx.mcp.tool()
def reindex(what: str = "codebase") -> str:
    """Rebuild the search index. what: 'codebase' (code chunks + symbols, handles both),
    'symbols' (symbol index only — faster for symbol-only changes). Replaces calling
    index_codebase + index_symbols separately. File watcher handles individual saves."""
    ctx.ensure_ready_sync()
    if what == "symbols":
        return index_symbols()
    return index_codebase()
