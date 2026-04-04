"""code-docs-rag analysis tools."""
import os
import time
import logging

from server import context as ctx
from server.helpers import (
    get_context_budget, validate_project_path, fmt_score, fmt_sim_score,
    format_knowledge_results, check_path_in_project,
    BUDGET_LIMITS, CROSSLAYER_BOUNDARY_VIOLATIONS,
)
from rag_engine import summarize_chunk
from lang_registry import ext_to_lang
from symbols import (
    collect_all_symbols,
    find_callers as _find_callers,
    find_iife_globals as _find_iife_globals,
    get_type_hierarchy as _get_type_hierarchy,
    preview_rename as _preview_rename,
)
from structure import file_summary as _file_summary, module_map as _module_map, format_module_map as _format_module_map
from analysis import (
    get_dependency_graph as _get_dep_graph,
    find_similar_code as _find_similar,
    trace_cross_language as _trace_cross_lang,
)

logger = logging.getLogger("code-docs-rag")

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
def impact_analysis(symbol_name: str, language: str = "") -> str:
    """Analyze the impact of changing a symbol: who calls it, what it calls, and knowledge constraints."""
    if not symbol_name.strip():
        return "Error: symbol_name cannot be empty."
    if len(symbol_name.strip()) < 2:
        return f"Error: symbol_name '{symbol_name}' too short (min 2 chars)."
    parts = []
    # Who calls this?
    callers = _find_callers(symbol_name, ctx.PROJECT_ROOT, lang_filter=language)
    caller_files = sorted(set(r['file'].replace(ctx.PROJECT_ROOT + '/', '') for r in callers))
    parts.append(f"## Callers ({len(callers)} sites in {len(caller_files)} files)")
    for f in caller_files[:15]:
        parts.append(f"  {f}")
    if len(caller_files) > 15:
        parts.append(f"  ... and {len(caller_files) - 15} more files")
    # What does it call? (via cross_language_trace)
    trace = _trace_cross_lang(symbol_name, ctx.PROJECT_ROOT)
    if trace.get("ts_callers"):
        parts.append(f"\n## References ({len(trace['ts_callers'])} total)")
        for ref in trace["ts_callers"][:10]:
            parts.append(f"  {ref['file'].replace(ctx.PROJECT_ROOT + '/', '')}:{ref['line']}")
    # Knowledge constraints
    kb_results = ctx.project_engine.search_knowledge(symbol_name, top_k=3)
    if kb_results:
        parts.append(f"\n## Knowledge Constraints ({len(kb_results)} entries)")
        for k in kb_results:
            parts.append(f"  [{k['category']}] {k['title']}")
            parts.append(f"    {k['content'][:120]}...")
    else:
        parts.append("\n## Knowledge Constraints: none found")
    # File summary
    syms = collect_all_symbols(ctx.PROJECT_ROOT)
    matching = [s for s in syms if s["name"] == symbol_name]
    if matching:
        s = matching[0]
        parts.append(f"\n## Definition: {s['file'].replace(ctx.PROJECT_ROOT + '/', '')}:{s['line']} [{s['kind']}]")
    return "\n".join(parts)



@ctx.mcp.tool()
def convention_check(file_path: str) -> str:
    """Check a file against project conventions: line count, naming, registration, boundary rules."""
    abs_path = validate_project_path(file_path, ctx.PROJECT_ROOT)
    if abs_path is None:
        return f"Error: path '{file_path}' is outside the project root."
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
    rel_path = abs_path.replace(ctx.PROJECT_ROOT + "/", "")
    if "/crossLayer/" in rel_path:
        for dr in CROSSLAYER_BOUNDARY_VIOLATIONS:
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
    kb_results = ctx.project_engine.search_knowledge(module_name, top_k=2)
    constraints = kb_results
    if constraints:
        issues.append(f"KB: {len(constraints)} knowledge entry/entries mention this module:")
        for k in constraints:
            issues.append(f"  [{k['category']}] {k['title']}")
    # Bayesian pattern confidence: how does this file compare to codebase norms?
    if rel_path.startswith("src/") and rel_path.endswith(".js"):
        from file_walker import walk_code_files
        sample_lines = []
        for sfp in walk_code_files(ctx.PROJECT_ROOT):
            srel = str(sfp).replace(ctx.PROJECT_ROOT + "/", "")
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
                pct = max(1, round(100 * len([l for l in sample_lines if l >= len(lines)]) / len(sample_lines)))
                issues.append(f"OUTLIER: {len(lines)} lines is {z_score:.1f} std devs above median ({median:.0f}). Top {pct}% largest.")
            elif z_score < -1.5:
                issues.append(f"NOTE: {len(lines)} lines is unusually small ({z_score:.1f} std devs below median {median:.0f}).")

    if not issues:
        return f"CLEAN: {rel_path} ({len(lines)} lines) - no convention issues found."
    return f"REVIEW: {rel_path} ({len(lines)} lines)\n" + "\n".join(f"  - {i}" for i in issues)



@ctx.mcp.tool()
def before_editing(file_path: str) -> str:
    """Call BEFORE editing any file. Assembles everything you need to know: KB constraints, callers, boundary rules, recent changes, and danger zones. One call replaces the entire pre-edit research workflow."""
    if not file_path or not file_path.strip():
        return "Error: file_path cannot be empty. Pass the relative or absolute path to the file you are about to edit."
    budget = get_context_budget()
    limits = BUDGET_LIMITS[budget]
    abs_path = validate_project_path(file_path, ctx.PROJECT_ROOT)
    if abs_path is None:
        return f"Error: path '{file_path}' is outside the project root."
    if not os.path.isfile(abs_path):
        return f"File not found: {abs_path}\nCheck the path and try again. Use get_module_map to find files by directory."
    rel_path = abs_path.replace(os.path.realpath(ctx.PROJECT_ROOT) + "/", "")
    module_name = os.path.basename(abs_path).replace(".js", "").replace(".ts", "")
    parts = [f"# Before Editing: {rel_path} (context: {budget})\n"]

    # 1. KB constraints — keep all results since cross-encoder scores aren't 0-1 bounded
    kb_results = ctx.project_engine.search_knowledge(module_name, top_k=limits["kb_entries"])
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
    callers = _find_callers(module_name, ctx.PROJECT_ROOT)
    callers = [r for r in callers if module_name not in os.path.basename(r.get('file', ''))]
    caller_files = sorted(set(r['file'].replace(ctx.PROJECT_ROOT + '/', '') for r in callers))
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
            for dr in CROSSLAYER_BOUNDARY_VIOLATIONS:
                if dr in content and "conductorSignalBridge" not in content:
                    warnings.append(f"BOUNDARY VIOLATION: uses '{dr}' without conductorSignalBridge")
        if "(function deepFreeze" in content or "(function deepFreezeObj" in content:
            warnings.append("DRY: inline deepFreeze (use shared utility)")
        if "=== 'L1' ? 'L2' : 'L1'" in content and "crossLayerHelpers" not in os.path.basename(abs_path):
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



@ctx.mcp.tool()
def what_did_i_forget(changed_files: str) -> str:
    """Call AFTER implementing changes, BEFORE running pipeline. Takes comma-separated file paths. Checks changed files against KB for missed constraints, boundary violations, and doc update needs. Output scales with remaining context window."""
    budget = get_context_budget()
    limits = BUDGET_LIMITS[budget]
    files = [f.strip() for f in changed_files.split(",") if f.strip()]
    if not files:
        return "No files specified. Pass comma-separated paths."
    parts = [f"# Post-Change Audit (context: {budget})\n"]
    all_warnings = []
    doc_updates_needed = set()
    for file_path in files:
        abs_path = validate_project_path(file_path, ctx.PROJECT_ROOT)
        if abs_path is None:
            all_warnings.append(f"[{file_path}] SKIPPED: outside project root")
            continue
        rel_path = abs_path.replace(os.path.realpath(ctx.PROJECT_ROOT) + "/", "")
        module_name = os.path.basename(abs_path).replace(".js", "").replace(".ts", "")
        # Check KB for constraints on this module
        kb_results = ctx.project_engine.search_knowledge(module_name, top_k=limits["kb_entries"])
        for k in kb_results:
            all_warnings.append(f"[{rel_path}] KB constraint: [{k['category']}] {k['title']}")
        # Check if crossLayer file touches conductor
        try:
            content = open(abs_path, encoding="utf-8", errors="ignore").read()
            if "/crossLayer/" in rel_path:
                for dr in CROSSLAYER_BOUNDARY_VIOLATIONS:
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



@ctx.mcp.tool()
def module_story(module_name: str) -> str:
    """Tell the story of a module: definition, evolution history from KB, callers, conventions, and current health. A living biography. Output is automatically scaled based on remaining context window — greedy when context is plentiful, minimal when tight."""
    if not module_name.strip():
        return "Error: module_name cannot be empty."
    budget = get_context_budget()
    limits = BUDGET_LIMITS[budget]
    parts = [f"# Module Story: {module_name} (context: {budget})\n"]
    # Definition — try exact symbol match, then prefix match, then file search
    syms = collect_all_symbols(ctx.PROJECT_ROOT)
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
        candidates = _glob.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", f"{module_name}.js"), recursive=True)
        if candidates:
            matching = [{"name": module_name, "kind": "module", "file": candidates[0], "line": 1, "signature": ""}]
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
    # Evolution history from KB
    kb_limit = limits["kb_entries"] * 2  # module_story should show more history
    kb_results = ctx.project_engine.search_knowledge(module_name, top_k=kb_limit)
    relevant = kb_results
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
    callers = [r for r in callers if module_name not in os.path.basename(r.get('file', ''))]
    caller_files = sorted(set(r['file'].replace(ctx.PROJECT_ROOT + '/', '') for r in callers))
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
            similar = _find_similar(content, ctx.project_engine, top_k=sim_limit)
            if similar:
                parts.append(f"\n## Similar Modules")
                for r in similar:
                    parts.append(f"  {r['source'].replace(ctx.PROJECT_ROOT + '/', '')} ({fmt_sim_score(r['score'])})")
        except Exception:
            pass
    return "\n".join(parts)



@ctx.mcp.tool()
def diagnose_error(error_text: str) -> str:
    """Paste a pipeline error. Returns: likely source file, relevant KB entries, similar past bugs, and fix patterns."""
    if not error_text or not error_text.strip():
        return "Error: error_text cannot be empty. Paste the error message or stack trace."
    parts = ["# Error Diagnosis\n"]
    # Extract symbol/file references from error text
    import re
    file_refs = re.findall(r'((?:[\w./-]+/)+[\w.\-]+\.(?:js|ts|py)):?(\d+)?', error_text)
    # Filter symbols: require camelCase (uppercase after lowercase) to avoid common English words
    symbol_refs = re.findall(r'\b([a-z]+[A-Z][a-zA-Z]{3,})\b', error_text)
    error_type = re.search(r'(TypeError|ReferenceError|Error|RangeError):\s*(.+?)(?:\n|$)', error_text)
    if error_type:
        parts.append(f"## Error: {error_type.group(1)}: {error_type.group(2)[:100]}")
    if file_refs:
        parts.append(f"\n## Source Files")
        for fpath, line in file_refs[:5]:
            rel = fpath.replace(ctx.PROJECT_ROOT + '/', '')
            parts.append(f"  {rel}" + (f":{line}" if line else ""))
    # Search KB for similar bugs — by error message AND by module names from stack
    kb_query = error_type.group(2)[:60] if error_type else error_text[:80]
    kb_results = ctx.project_engine.search_knowledge(kb_query, top_k=5)
    # Also search by module names from file refs for broader matches
    for fpath, _ in file_refs[:3]:
        module = os.path.basename(fpath).replace('.js', '').replace('.ts', '')
        module_kb = ctx.project_engine.search_knowledge(module, top_k=2)
        kb_results.extend([k for k in module_kb if k["id"] not in {r["id"] for r in kb_results}])
    if kb_results:
        parts.append(f"\n## Related KB Entries ({len(kb_results)})")
        for k in kb_results:
            parts.append(f"  **[{k['category']}] {k['title']}**")
            parts.append(f"  {k['content'][:150]}")
            parts.append("")
    # Symbol context
    unique_symbols = list(set(symbol_refs))[:5]
    for sym in unique_symbols:
        callers = _find_callers(sym, ctx.PROJECT_ROOT)
        if 1 <= len(callers) <= 20:
            parts.append(f"\n## '{sym}' appears in {len(callers)} locations")
            for r in callers[:3]:
                parts.append(f"  {r['file'].replace(ctx.PROJECT_ROOT + '/', '')}:{r['line']}")
    if not file_refs and not kb_results and not unique_symbols:
        parts.append("\nNo specific diagnosis available. Try search_knowledge with key terms from the error.")
    return "\n".join(parts)



@ctx.mcp.tool()
def codebase_health() -> str:
    """Full-repo convention sweep. Returns prioritized report of all files with issues."""
    from file_walker import walk_code_files
    issues_by_severity = {"CRITICAL": [], "WARN": [], "NOTE": []}
    file_count = 0
    for fpath in walk_code_files(ctx.PROJECT_ROOT):
        rel = str(fpath).replace(ctx.PROJECT_ROOT + "/", "")
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
            for dr in CROSSLAYER_BOUNDARY_VIOLATIONS:
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



@ctx.mcp.tool()
def find_dead_code(path: str = "src") -> str:
    """Scan all IIFE globals for zero external callers AND no conductor self-registration (truly dormant modules). Modules that self-register via conductorIntelligence.register* are active even without direct callers — their biases flow through the conductor signal pipeline via callbacks."""
    from file_walker import walk_code_files
    target = os.path.join(ctx.PROJECT_ROOT, path) if not os.path.isabs(path) else path
    registration_patterns = [
        'conductorIntelligence.register',
        'crossLayerRegistry.register',
        'feedbackRegistry.register',
    ]
    dormant = []
    active = []
    self_registered = []
    for fpath in walk_code_files(target):
        if not str(fpath).endswith('.js'):
            continue
        try:
            content = fpath.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        iife_names = _find_iife_globals(content)
        for name in iife_names:
            # Check for self-registration of THIS specific symbol (not just any in the file)
            has_registration = any(f"{pat}('{name}" in content or f'{pat}("{name}' in content for pat in registration_patterns)
            # Fallback: if file has only one IIFE global, file-level check is fine
            if not has_registration:
                has_registration = any(pat in content for pat in registration_patterns) and len(iife_names) == 1
            callers = _find_callers(name, ctx.PROJECT_ROOT)
            # Exclude self-references (same file)
            external = [c for c in callers if os.path.basename(c['file']) != os.path.basename(str(fpath))]
            if not external and not has_registration:
                rel = str(fpath).replace(ctx.PROJECT_ROOT + '/', '')
                dormant.append(f"  {name} ({rel}) -- 0 external callers, no self-registration")
            elif not external and has_registration:
                self_registered.append(name)
            else:
                active.append(name)
    if not dormant:
        return f"No dead code found. {len(active)} globals with direct callers, {len(self_registered)} active via conductor self-registration."
    parts = [f"# Dead Code Report ({len(dormant)} truly dormant globals)\n"]
    for d in sorted(dormant):
        parts.append(d)
    parts.append(f"\n{len(active)} active (direct callers) + {len(self_registered)} active (self-registered) = {len(active) + len(self_registered)} total active")
    return "\n".join(parts)



@ctx.mcp.tool()
def symbol_importance(top_n: int = 20) -> str:
    """Rank IIFE globals by caller count (architectural centrality). Most-called = most important."""
    from file_walker import walk_code_files
    symbols = []
    for fpath in walk_code_files(os.path.join(ctx.PROJECT_ROOT, 'src')):
        if not str(fpath).endswith('.js'):
            continue
        try:
            content = fpath.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        for name in _find_iife_globals(content):
            callers = _find_callers(name, ctx.PROJECT_ROOT)
            external = [c for c in callers if os.path.basename(c['file']) != os.path.basename(str(fpath))]
            rel = str(fpath).replace(ctx.PROJECT_ROOT + '/', '')
            symbols.append((len(external), name, rel))
    symbols.sort(key=lambda x: -x[0])
    parts = [f"# Symbol Importance (top {top_n} by caller count)\n"]
    for i, (count, name, rel) in enumerate(symbols[:top_n]):
        parts.append(f"  {i+1}. {name}: {count} callers ({rel})")
    if len(symbols) > top_n:
        parts.append(f"\n  ... {len(symbols) - top_n} more symbols")
    parts.append(f"\nTotal: {len(symbols)} IIFE globals scanned")
    return "\n".join(parts)



@ctx.mcp.tool()
def doc_sync_check(doc_path: str = "") -> str:
    """Check if a doc file is in sync with the codebase it describes. Finds stale references, missing tools, outdated counts."""
    target = doc_path if doc_path else os.path.join(ctx.PROJECT_ROOT, "doc/code-docs-rag.md")
    abs_target = target if os.path.isabs(target) else os.path.join(ctx.PROJECT_ROOT, target)
    if not os.path.isfile(abs_target):
        return f"File not found: {abs_target}"
    doc_content = open(abs_target, encoding="utf-8", errors="ignore").read()
    issues = []
    # Check tool count claim
    import re
    count_match = re.search(r'(\d+)\s+(?:MCP\s+)?tools', doc_content)
    # Tools are now split across multiple files in the server/ package
    _server_dir = os.path.dirname(__file__)
    _tool_files = ["tools_search.py", "tools_analysis.py", "tools_knowledge.py", "tools_index.py"]
    actual_tools = 0
    server_content_parts = []
    for _tf in _tool_files:
        _tf_path = os.path.join(_server_dir, _tf)
        if os.path.isfile(_tf_path):
            _lines = open(_tf_path, encoding="utf-8").readlines()
            actual_tools += sum(1 for l in _lines if l.strip().startswith("@ctx.mcp.tool"))
            server_content_parts.append(open(_tf_path, encoding="utf-8").read())
    if count_match:
        claimed = int(count_match.group(1))
        if claimed != actual_tools:
            issues.append(f"STALE: doc claims {claimed} tools, server has {actual_tools}")
    # Check file/chunk/symbol counts
    stats_match = re.search(r'Files:\s*(\d+)', doc_content)
    if stats_match:
        claimed_files = int(stats_match.group(1))
        from file_walker import walk_code_files
        actual_files = sum(1 for _ in walk_code_files(ctx.PROJECT_ROOT))
        if abs(claimed_files - actual_files) > 10:
            issues.append(f"STALE: doc claims {claimed_files} files, actual {actual_files}")
    # Check for tool names in doc that don't exist in server
    server_content = "\n".join(server_content_parts)
    doc_tool_refs = set(re.findall(r'`(\w{4,})`', doc_content))
    server_fns = set(re.findall(r'def (\w+)\(', server_content))
    # Also collect parameter names to avoid false positives
    param_names = set(re.findall(r'(\w+)\s*[:=]', server_content))
    known_non_tools = param_names | {"response_format", "file_type", "top_k", "top_n", "max_depth", "max_tokens", "file_path", "scope", "entry_id"}
    # Only flag identifiers that look like they should be server tools
    tool_like = {t for t in doc_tool_refs if t.islower() and '_' in t and t not in server_fns and t not in known_non_tools and len(t) > 6}
    if tool_like:
        issues.append(f"MISSING: doc references tools not in server: {', '.join(sorted(tool_like))}")
    if not issues:
        return f"IN SYNC: {os.path.basename(abs_target)} matches server ({actual_tools} tools)"
    return f"OUT OF SYNC: {os.path.basename(abs_target)}\n" + "\n".join(f"  - {i}" for i in issues)



@ctx.mcp.tool()
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
    kb_hits = ctx.project_engine.search_knowledge(about, top_k=3)
    relevant = kb_hits
    if relevant:
        parts.append("**Relevant KB:**")
        for k in relevant:
            parts.append(f"  [{k['category']}] {k['title']}: {k['content'][:100]}...")
    parts.append("\n**Now reflect and respond before proceeding.**")
    return "\n".join(parts)



@ctx.mcp.tool()
def blast_radius(symbol_name: str, max_depth: int = 3) -> str:
    """Trace the full transitive dependency chain of a symbol: who calls it, who calls those callers, etc. Deeper than impact_analysis."""
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
    parts.append(f"\nTotal blast radius: {total} sites across {len(layers)} depth levels")
    all_files = set()
    for _, results in layers:
        for r in results:
            f = r.strip().split(":")[0]
            all_files.add(f)
    parts.append(f"Files affected: {len(all_files)}")
    return "\n".join(parts)



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

    return "\n\n---\n\n".join(parts)



