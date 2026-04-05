"""HME symbol, structure, and trace tools."""
import os
import logging

from server import context as ctx
from server.helpers import get_context_budget, validate_project_path, fmt_score, fmt_sim_score, BUDGET_LIMITS
from lang_registry import ext_to_lang
from symbols import collect_all_symbols, get_type_hierarchy as _get_type_hierarchy, preview_rename as _preview_rename
from structure import file_summary as _file_summary, module_map as _module_map, format_module_map as _format_module_map
from analysis import get_dependency_graph as _get_dep_graph, find_similar_code as _find_similar, trace_cross_language as _trace_cross_lang

logger = logging.getLogger("HyperMeta-Ecstasy")

@ctx.mcp.tool()
def get_dependency_graph(file_path: str) -> str:
    """Map the import/require dependency graph for a single file. Shows what the file imports (with resolved paths) and which files import it. Accepts relative or absolute paths. Use to understand a file's position in the dependency tree before refactoring or moving it."""
    abs_path = validate_project_path(file_path, ctx.PROJECT_ROOT)
    if abs_path is None:
        return f"Error: path '{file_path}' is outside the project root."
    result = _get_dep_graph(abs_path, ctx.PROJECT_ROOT)

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


@ctx.mcp.tool()
def lookup_symbol(name: str, kind: str = "", language: str = "") -> str:
    """Find where a symbol is defined by exact name match. Returns the file, line number, kind (global, function, class), and signature for each match. Use kind='global' to filter to IIFE globals only, or kind='function' for inner functions. For fuzzy/semantic symbol search, use search_symbols instead."""
    ctx.ensure_ready_sync()
    if not name.strip():
        return "Error: name cannot be empty."
    results = ctx.project_engine.lookup_symbol(name, kind=kind, language=language)
    if not results:
        status = ctx.project_engine.get_symbol_status()
        if not status["indexed"]:
            return "No symbol index found. Run index_symbols first."
        return f"No symbols matching '{name}' found."

    lines = []
    for r in results:
        sig = f" {r['signature']}" if r['signature'] else ""
        lines.append(f"  [{r['kind']}] {r['name']}{sig}  ({r['file']}:{r['line']})")
    return f"Found {len(results)} symbol(s):\n" + "\n".join(lines)


@ctx.mcp.tool()
def search_symbols(query: str, top_k: int = 20, kind: str = "") -> str:
    """Semantic search across the symbol index. Unlike lookup_symbol (exact match), this finds symbols whose names or signatures are semantically similar to the query. Use kind='global' to filter to IIFE globals, 'function' for inner functions. Returns ranked results with file locations, kinds, signatures, and relevance scores."""
    ctx.ensure_ready_sync()
    if not query or not query.strip():
        return "Error: query cannot be empty. Pass a symbol name or description to search for."
    top_k = max(1, min(50, top_k))
    results = ctx.project_engine.search_symbols(query, top_k=top_k, kind=kind)
    if not results:
        status = ctx.project_engine.get_symbol_status()
        if not status["indexed"]:
            return "No symbol index found. Run index_symbols first."
        return "No matching symbols found."

    lines = []
    for i, r in enumerate(results):
        sig = f" {r['signature']}" if r['signature'] else ""
        lines.append(
            f"[{i+1}] [{r['kind']}] {r['name']}{sig}\n"
            f"     {r['file']}:{r['line']} ({r['language']}, score: {fmt_sim_score(r['score'])})"
        )
    return "\n".join(lines)


@ctx.mcp.tool()
def get_file_summary(file_path: str) -> str:
    """Get a structural overview of a file: line count, symbol kinds, and all symbol definitions with line numbers and signatures. Use to quickly understand a file's API surface without reading the full source. Accepts relative or absolute paths."""
    abs_path = validate_project_path(file_path, ctx.PROJECT_ROOT)
    if abs_path is None:
        return f"Error: path '{file_path}' is outside the project root."
    result = _file_summary(abs_path)

    if "error" in result:
        return f"Error: {result['error']}"

    parts = [f"File: {result['file']} ({result['lines']} lines)"]

    if result["by_kind"]:
        def _pl(n, w): return f"{n} {w}" if n == 1 else (f"{n} {w}es" if w.endswith(("s","sh","ch","x","z")) else f"{n} {w}s")
        kind_str = ", ".join(_pl(v, k) for k, v in sorted(result["by_kind"].items(), key=lambda x: -x[1]))
        parts.append(f"Symbols: {kind_str}")
    else:
        parts.append("Symbols: none (data file or unsupported pattern)")

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


@ctx.mcp.tool()
def get_module_map(directory: str = "", max_depth: int = 3) -> str:
    """Show the directory tree structure with line counts per file. Use to get a bird's-eye view of a subsystem's organization. Set directory='src/crossLayer' or just 'crossLayer' to scope to a subdirectory, or omit for the full project. max_depth controls how deep to recurse (default 3)."""
    if directory:
        target = os.path.join(ctx.PROJECT_ROOT, directory)
        if not os.path.isdir(target):
            # Try with src/ prefix for subsystem shorthand (e.g., "crossLayer" -> "src/crossLayer")
            target = os.path.join(ctx.PROJECT_ROOT, "src", directory)
    else:
        target = ctx.PROJECT_ROOT
    if not os.path.isdir(target):
        return f"Error: directory not found: {directory!r} (tried with and without 'src/' prefix)"

    tree = _module_map(target, max_depth=max_depth)
    formatted = _format_module_map(tree)
    return formatted if formatted else "Empty directory or no code files found."


@ctx.mcp.tool()
def type_hierarchy(type_name: str = "") -> str:
    """Show the class/interface inheritance hierarchy. With no arguments, shows all root types and their subtypes. With type_name, shows the specific type's extends/implements relationships and who extends/implements it. Useful for understanding polymorphism and interface contracts in the codebase."""
    result = _get_type_hierarchy(ctx.PROJECT_ROOT)
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


@ctx.mcp.tool()
def cross_language_trace(symbol_name: str) -> str:
    """Trace a symbol across language boundaries: Rust definition, WASM bridge, and TypeScript/JavaScript callers. Reconstructs the full call chain from native code through FFI to the JS runtime. Useful for understanding cross-language dependencies and WASM integration points."""
    if not symbol_name.strip():
        return "Error: symbol_name cannot be empty."
    result = _trace_cross_lang(symbol_name, ctx.PROJECT_ROOT)

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
        parts.append(f"\nJS/TS callers ({len(result['ts_callers'])}):")
        for tc in result["ts_callers"][:20]:
            parts.append(f"  {tc['file']}:{tc['line']} - {tc['text'][:100]}")

    if result["chain"]:
        parts.append(f"\nCall chain:\n  " + "\n  -> ".join(result["chain"]))

    return "\n".join(parts)


@ctx.mcp.tool()
def bulk_rename_preview(old_name: str, new_name: str, language: str = "") -> str:
    """Preview what a symbol rename would change across the codebase WITHOUT making any modifications. Shows each occurrence categorized by type (definition, reference, import, string, comment) and whether it would be renamed or skipped. Use to assess rename safety and scope before committing to a refactor."""
    if not old_name.strip():
        return "Error: old_name cannot be empty."
    if not new_name.strip():
        return "Error: new_name cannot be empty."
    results = _preview_rename(old_name, new_name, ctx.PROJECT_ROOT, language=language)
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


@ctx.mcp.tool()
def get_function_body(function_name: str, file_path: str = "", language: str = "") -> str:
    """Extract the complete source code of a named function. If file_path is given, searches only that file. Otherwise, looks up the function in the symbol index and extracts from the first matching file(s). Returns the function body with line numbers and kind (function, method, etc). Useful for reading a specific function without loading the entire file."""
    ctx.ensure_ready_sync()
    from chunker import get_function_body as _get_body

    if file_path:
        abs_path = validate_project_path(file_path, ctx.PROJECT_ROOT)
        if abs_path is None:
            return f"Error: path '{file_path}' is outside the project root."
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

    results = ctx.project_engine.lookup_symbol(function_name, kind="", language=language)
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

    return "\n---\n".join(parts)
