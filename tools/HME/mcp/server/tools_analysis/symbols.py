"""HME symbol, structure, and trace tools."""
import os
import logging

from server import context as ctx
from server.helpers import get_context_budget, validate_project_path, fmt_score, fmt_sim_score, BUDGET_LIMITS
from . import _track
from lang_registry import ext_to_lang
from symbols import collect_all_symbols, get_type_hierarchy as _get_type_hierarchy, preview_rename as _preview_rename
from structure import file_summary as _file_summary, module_map as _module_map, format_module_map as _format_module_map
from analysis import get_dependency_graph as _get_dep_graph, find_similar_code as _find_similar, trace_cross_language as _trace_cross_lang

logger = logging.getLogger("HME")

_GLOBALS_DTS_PATH = "src/types/globals.d.ts"
_GLOBALS_CACHE: list[str] | None = None


def _get_architectural_globals() -> list[str]:
    """Extract architectural (module-level) global names from globals.d.ts.
    Filters to names >= 10 chars to skip utility functions (clamp, rf, m, etc.).
    Results are cached for the server lifetime."""
    global _GLOBALS_CACHE
    if _GLOBALS_CACHE is not None:
        return _GLOBALS_CACHE
    import re as _re
    dts_path = os.path.join(ctx.PROJECT_ROOT, _GLOBALS_DTS_PATH)
    if not os.path.isfile(dts_path):
        _GLOBALS_CACHE = []
        return _GLOBALS_CACHE
    names: list[str] = []
    try:
        with open(dts_path, encoding="utf-8") as _f:
            for _line in _f:
                m = _re.match(r"^declare var ([a-zA-Z_]\w+)\s*:", _line)
                if m:
                    name = m.group(1)
                    if len(name) >= 10:  # architectural globals only
                        names.append(name)
    except Exception:
        pass
    _GLOBALS_CACHE = names
    return _GLOBALS_CACHE


def get_dependency_graph(file_path: str) -> str:
    """Map import/require dependency graph for a file. Internal — call via file_intel(path, mode='deps')."""
    import re as _re
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

    # Referenced globals — architectural globals (>=10 chars) referenced in this file.
    # Require-based deps miss all globals; this surfaces the actual module dependencies.
    if abs_path and os.path.isfile(abs_path):
        try:
            src = open(abs_path, encoding="utf-8").read()
            arch_globals = _get_architectural_globals()
            # Only report globals that appear as standalone identifiers (word boundary)
            referenced = [g for g in arch_globals if _re.search(r'\b' + _re.escape(g) + r'\b', src)]
            if referenced:
                parts.append(f"Referenced Globals ({len(referenced)}):\n" +
                              "\n".join(f"  {g}" for g in sorted(referenced)))
        except Exception:
            pass

    return "\n\n".join(parts)


def lookup_symbol(symbol_name: str, kind: str = "", language: str = "") -> str:
    """Find where a symbol is defined by exact name match. Returns the file, line number, kind (global, function, class), and signature for each match. Use kind='global' to filter to IIFE globals only, or kind='function' for inner functions. For fuzzy/semantic symbol search, use search_symbols instead."""
    ctx.ensure_ready_sync()
    if not symbol_name.strip():
        return "Error: symbol_name cannot be empty."
    results = ctx.project_engine.lookup_symbol(symbol_name, kind=kind, language=language)
    if not results:
        status = ctx.project_engine.get_symbol_status()
        if not status["indexed"]:
            return "No symbol index found. Run index_symbols first."
        return f"No symbols matching '{symbol_name}' found."

    lines = []
    for r in results:
        sig = f" {r['signature']}" if r['signature'] else ""
        lines.append(f"  [{r['kind']}] {r['name']}{sig}  ({r['file']}:{r['line']})")
    return f"Found {len(results)} symbol(s):\n" + "\n".join(lines)


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


def get_file_summary(file_path: str) -> str:
    """Structural overview of a file: line count, symbols, signatures. Internal — call via file_intel(path, mode='summary')."""
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


def type_hierarchy(type_name: str = "") -> str:
    """Show module dependency hierarchy. For TS/class projects: class/interface inheritance (extends/implements).
    For CommonJS IIFE projects (like this one): shows which IIFE globals each module depends on,
    surfacing the layered require chain and manager/helper relationships.
    With type_name, focuses on that specific module's direct dependencies and dependents."""
    result = _get_type_hierarchy(ctx.PROJECT_ROOT)
    types = result.get("types", {})

    # If formal type hierarchy exists (TypeScript classes/interfaces), use it directly
    if types:
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

    # CommonJS IIFE project fallback: build dependency graph from globals.d.ts + require chains
    import re as _re
    import glob as _glob_mod

    arch_globals = _get_architectural_globals()
    if not arch_globals:
        return "No type hierarchy found and no globals.d.ts to build IIFE dependency map."

    # Build: module -> set of globals it directly references
    global_set = set(g.lower() for g in arch_globals)
    dep_graph: dict[str, set[str]] = {}  # module_name -> globals it uses
    rev_graph: dict[str, set[str]] = {}  # global -> modules that use it

    for js_file in _glob_mod.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", "*.js"), recursive=True):
        if "index.js" in js_file or "/node_modules/" in js_file:
            continue
        basename = os.path.basename(js_file).replace(".js", "")
        try:
            content = open(js_file, encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        # Find all global names referenced in this file (skip its own definition)
        used = set()
        for g in arch_globals:
            if g == basename:
                continue
            if _re.search(r'\b' + _re.escape(g) + r'\b', content):
                used.add(g)
        if used:
            dep_graph[basename] = used
            for g in used:
                rev_graph.setdefault(g, set()).add(basename)

    if not dep_graph:
        return "No IIFE dependency relationships found."

    if type_name:
        name_lower = type_name.lower()
        # Find as a module (something that depends on others)
        deps = dep_graph.get(type_name) or dep_graph.get(name_lower) or set()
        # Find as a depended-on global
        dependents = rev_graph.get(type_name) or rev_graph.get(name_lower) or set()
        parts = [f"## IIFE Module: '{type_name}'"]
        if deps:
            parts.append(f"\nDepends on ({len(deps)} globals):")
            for d in sorted(deps):
                parts.append(f"  -> {d}")
        else:
            parts.append("\nDepends on: (no tracked globals)")
        if dependents:
            parts.append(f"\nUsed by ({len(dependents)} modules):")
            for d in sorted(dependents):
                parts.append(f"  <- {d}")
        else:
            parts.append("\nUsed by: (nothing found)")
        return "\n".join(parts)

    # Full graph: show modules with most dependencies first (most interconnected)
    sorted_modules = sorted(dep_graph.items(), key=lambda x: -len(x[1]))
    parts = [f"## IIFE Module Dependency Map ({len(dep_graph)} modules)\n"]
    parts.append("Modules sorted by outbound dependency count (most coupled first):\n")
    for mod, deps in sorted_modules[:30]:
        n_users = len(rev_graph.get(mod, set()))
        parts.append(f"  {mod} → [{len(deps)} deps, {n_users} users]: {', '.join(sorted(deps)[:6])}"
                     + (" ..." if len(deps) > 6 else ""))
    # Roots: globals with most dependents (most fundamental)
    parts.append(f"\n## Most Depended-On Globals (top 10):")
    top_depended = sorted(rev_graph.items(), key=lambda x: -len(x[1]))[:10]
    for g, users in top_depended:
        parts.append(f"  {g}: {len(users)} modules depend on it")

    # Manager/helper pairing: detect *Manager files and their *Helpers counterparts
    manager_pairs = []
    for js_file in _glob_mod.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", "*Manager.js"), recursive=True):
        stem = os.path.basename(js_file).replace("Manager.js", "")
        # Search for matching *Helpers.js (plural suffix convention in this project)
        helpers_pat = os.path.join(ctx.PROJECT_ROOT, "src", "**", f"{stem}*Helpers.js")
        helper_matches = _glob_mod.glob(helpers_pat, recursive=True)
        helper_name = os.path.basename(helper_matches[0]).replace(".js", "") if helper_matches else None
        mgr_name = os.path.basename(js_file).replace(".js", "")
        users_of_mgr = len(rev_graph.get(mgr_name, set()))
        manager_pairs.append((mgr_name, helper_name, users_of_mgr))

    if manager_pairs:
        parts.append(f"\n## Manager/Helper Pairs ({len(manager_pairs)} managers):")
        for mgr, hlp, users in sorted(manager_pairs, key=lambda x: -x[2]):
            hlp_str = f" + {hlp}" if hlp else " (no helpers file)"
            parts.append(f"  {mgr}{hlp_str} [{users} dependents]")

    # Subsystem rollup: group module dep counts by src/ subdirectory
    subsystem_totals: dict[str, dict] = {}
    for js_file in _glob_mod.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", "*.js"), recursive=True):
        rel = js_file.replace(ctx.PROJECT_ROOT + "/src/", "")
        parts_rel = rel.split("/")
        subsystem = parts_rel[0] if len(parts_rel) > 1 else "root"
        basename = os.path.basename(js_file).replace(".js", "")
        n_deps = len(dep_graph.get(basename, set()))
        n_users = len(rev_graph.get(basename, set()))
        if subsystem not in subsystem_totals:
            subsystem_totals[subsystem] = {"files": 0, "total_deps": 0, "total_users": 0}
        subsystem_totals[subsystem]["files"] += 1
        subsystem_totals[subsystem]["total_deps"] += n_deps
        subsystem_totals[subsystem]["total_users"] += n_users
    if subsystem_totals:
        parts.append(f"\n## Subsystem Rollup ({len(subsystem_totals)} subsystems):")
        for sub, stats in sorted(subsystem_totals.items(), key=lambda x: -x[1]["total_users"]):
            avg_deps = stats["total_deps"] / max(stats["files"], 1)
            parts.append(f"  {sub:<20} {stats['files']:3} files  avg_deps={avg_deps:.1f}  total_users={stats['total_users']}")

    return "\n".join(parts)


def cross_language_trace(symbol_name: str) -> str:
    """Trace a symbol's call chain. For Rust/WASM projects: Rust definition → WASM bridge → JS callers.
    For pure-JS CommonJS projects (like this one): IIFE global definition → direct callers → require chain.
    Also attaches KB constraints for the symbol and flags hot-path callers."""
    if not symbol_name.strip():
        return "Error: symbol_name cannot be empty."
    result = _trace_cross_lang(symbol_name, ctx.PROJECT_ROOT)

    # Rust/WASM path
    if result.get("rust_definition"):
        parts = [f"## Cross-language trace: '{symbol_name}'"]
        rd = result["rust_definition"]
        wasm_tag = " [wasm_bindgen]" if rd["is_wasm_export"] else ""
        parts.append(f"\nRust definition: {rd['file']}:{rd['line']}{wasm_tag}")
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

    # Pure-JS CommonJS path: IIFE global → callers → require chain
    parts = [f"## JS Module Trace: '{symbol_name}'"]

    # 1. Find definition via symbol table
    if ctx.project_engine.symbol_table is not None:
        try:
            all_rows = ctx.project_engine.symbol_table.to_arrow().to_pylist()
            defs = [r for r in all_rows if r["name"].lower() == symbol_name.lower()]
            if defs:
                d = defs[0]
                rel = d["file"].replace(ctx.PROJECT_ROOT + "/", "")
                parts.append(f"\n**Definition:** {rel}:{d['line']} [{d['kind']}]")
                if d.get("signature"):
                    parts.append(f"  Signature: {d['signature'][:120]}")
            else:
                parts.append(f"\nDefinition: not in symbol index (may be an IIFE global)")
        except Exception:
            pass

    # 2. Direct callers (who uses this symbol in src/)
    callers = _find_callers(symbol_name, ctx.PROJECT_ROOT)
    callers = [r for r in callers if not r["file"].endswith(".md")]
    caller_files = sorted(set(r["file"].replace(ctx.PROJECT_ROOT + "/", "") for r in callers))

    _hot = {
        "src/play/processBeat.js", "src/play/crossLayerBeatRecord.js",
        "src/play/emitPickCrossLayerRecord.js", "src/play/playNotesEmitPick.js",
        "src/play/main.js",
    }
    hot_callers = [f for f in caller_files if f in _hot]

    if caller_files:
        label = f"  [{len(hot_callers)} HOT PATH]" if hot_callers else ""
        parts.append(f"\n**Direct callers** ({len(callers)} sites in {len(caller_files)} files){label}:")
        for f in caller_files[:20]:
            flag = " [HOT PATH — per-beat]" if f in _hot else ""
            parts.append(f"  {f}{flag}")
        if len(caller_files) > 20:
            parts.append(f"  ... and {len(caller_files) - 20} more")
    else:
        parts.append("\nNo callers found in codebase (may be unused or loaded as side-effect).")

    # 3. Require chain: which index.js files pull this in?
    import re as _re
    require_pat = _re.compile(r"require\(['\"]([^'\"]+)['\"]")
    index_files = []
    import glob as _glob_mod
    for idx in _glob_mod.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", "index.js"), recursive=True):
        try:
            with open(idx, encoding="utf-8", errors="ignore") as _f:
                content = _f.read()
            if symbol_name.lower() in content.lower():
                rel = idx.replace(ctx.PROJECT_ROOT + "/", "")
                reqs = require_pat.findall(content)
                matching = [r for r in reqs if symbol_name.lower() in r.lower()]
                index_files.append((rel, matching))
        except Exception:
            continue
    if index_files:
        parts.append(f"\n**Require chain** (index.js files loading this):")
        for rel, reqs in index_files[:8]:
            req_str = f" via {reqs[0]}" if reqs else ""
            parts.append(f"  {rel}{req_str}")

    # 4. Reverse xref — exported API (what methods does this module expose?)
    if ctx.project_engine.symbol_table is not None:
        try:
            all_rows = ctx.project_engine.symbol_table.to_arrow().to_pylist()
            # Find the defining file first
            defs = [r for r in all_rows if r["name"].lower() == symbol_name.lower()]
            if defs:
                def_file = defs[0]["file"]
                # All symbols in that file = exported API surface
                api = [r for r in all_rows if r["file"] == def_file
                       and r["name"].lower() != symbol_name.lower()
                       and r["kind"] in ("function", "method", "variable")]
                if api:
                    parts.append(f"\n**Exported API** ({len(api)} symbols in {def_file.replace(ctx.PROJECT_ROOT + '/', '')}):")
                    for sym in sorted(api, key=lambda x: x["line"])[:20]:
                        sig = f"  {sym['name']}: {sym['signature'][:80]}" if sym.get("signature") else f"  {sym['name']} [{sym['kind']}]"
                        parts.append(sig)
                    if len(api) > 20:
                        parts.append(f"  ... and {len(api) - 20} more")
        except Exception:
            pass

    # 5. KB constraints
    kb = ctx.project_engine.search_knowledge(symbol_name, top_k=3)
    if kb:
        parts.append(f"\n**KB constraints** ({len(kb)} entries):")
        for k in kb:
            parts.append(f"  [{k['category']}] {k['title']}")
            parts.append(f"    {k['content'][:100]}...")

    return "\n".join(parts)


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
            with open(abs_path, encoding="utf-8", errors="ignore") as _f:
                content = _f.read()
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
            with open(sym["file"], encoding="utf-8", errors="ignore") as _f:
                content = _f.read()
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


def l0_channel_map(channel: str = "") -> str:
    """Map L0 channel producers and consumers. Shows which modules post to and read from
    each L0 channel. If channel is given, shows detailed view for that channel. Otherwise
    shows all channels with producer/consumer counts. Finds the invisible L0-mediated
    dependency edges that find_callers and blast_radius miss."""
    import re
    ctx.ensure_ready_sync()
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")

    post_pat = re.compile(r"""L0\.post\(\s*['"]([^'"]+)['"]""")
    read_pats = [
        re.compile(r"""L0\.getLast\(\s*['"]([^'"]+)['"]"""),
        re.compile(r"""L0\.query\(\s*['"]([^'"]+)['"]"""),
        re.compile(r"""L0\.findClosest\(\s*['"]([^'"]+)['"]"""),
        re.compile(r"""L0\.count\(\s*['"]([^'"]+)['"]"""),
        re.compile(r"""L0\.getBounds\(\s*['"]([^'"]+)['"]"""),
    ]

    # channel -> { producers: {file: [lines]}, consumers: {file: [lines]} }
    channels: dict[str, dict] = {}

    for dirpath, _, filenames in os.walk(src_root):
        for fname in filenames:
            if not fname.endswith(".js"):
                continue
            fpath = os.path.join(dirpath, fname)
            try:
                with open(fpath, encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()
            except Exception:
                continue
            rel = fpath.replace(ctx.PROJECT_ROOT + "/", "")
            for i, line in enumerate(lines, 1):
                for m_obj in post_pat.finditer(line):
                    ch = m_obj.group(1)
                    channels.setdefault(ch, {"producers": {}, "consumers": {}})
                    channels[ch]["producers"].setdefault(rel, []).append(i)
                for pat in read_pats:
                    for m_obj in pat.finditer(line):
                        ch = m_obj.group(1)
                        channels.setdefault(ch, {"producers": {}, "consumers": {}})
                        channels[ch]["consumers"].setdefault(rel, []).append(i)

    if not channels:
        return "No L0 channels found in src/."

    if channel:
        ch_data = channels.get(channel)
        if not ch_data:
            return f"Channel '{channel}' not found. Known channels: {', '.join(sorted(channels.keys()))}"
        parts = [f"# L0 Channel: {channel}\n"]
        parts.append(f"## Producers ({len(ch_data['producers'])} files)")
        for f, lines in sorted(ch_data["producers"].items()):
            parts.append(f"  {f}:{','.join(str(l) for l in lines)}")
        parts.append(f"\n## Consumers ({len(ch_data['consumers'])} files)")
        for f, lines in sorted(ch_data["consumers"].items()):
            parts.append(f"  {f}:{','.join(str(l) for l in lines)}")
        return "\n".join(parts)

    # Summary view
    parts = [f"# L0 Channel Map ({len(channels)} channels)\n"]
    for ch in sorted(channels.keys()):
        d = channels[ch]
        p = len(d["producers"])
        c = len(d["consumers"])
        parts.append(f"  {ch}: {p} producer(s), {c} consumer(s)")
    return "\n".join(parts)


def file_intel(file_path: str, mode: str = "both") -> str:
    """Unified file intelligence. Replaces get_file_summary + get_dependency_graph in one call.
    mode='both' (default): structural overview AND dependency graph — use before editing a file
    you haven't read yet to understand its API surface and its position in the dependency tree.
    mode='summary': line count, symbol kinds, all definitions with line numbers and signatures.
    Use to quickly understand a file's API surface without reading the full source.
    mode='deps': import/require dependency graph — what the file imports (with resolved paths)
    and which files import it. Use to assess refactor scope or understand load order.
    Accepts relative or absolute paths."""
    ctx.ensure_ready_sync()
    _track("file_intel")
    if not file_path.strip():
        return "Error: file_path cannot be empty."
    if mode == "summary":
        return get_file_summary(file_path)
    if mode == "deps":
        return get_dependency_graph(file_path)
    if mode == "both":
        summary = get_file_summary(file_path)
        deps = get_dependency_graph(file_path)
        return f"{summary}\n\n---\n\n{deps}"
    return f"Unknown mode '{mode}'. Use 'both', 'summary', or 'deps'."
