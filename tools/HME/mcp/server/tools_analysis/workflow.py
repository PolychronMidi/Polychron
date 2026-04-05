"""HME pre/post-edit workflow tools."""
import os
import logging

from server import context as ctx
from server.helpers import (
    get_context_budget, validate_project_path, fmt_score,
    format_knowledge_results, check_path_in_project,
    BUDGET_LIMITS, CROSSLAYER_BOUNDARY_VIOLATIONS,
    KNOWN_L0_CHANNELS, DRY_PATTERNS, DOC_UPDATE_TRIGGERS,
    LINE_COUNT_TARGET, LINE_COUNT_WARN,
)
from symbols import collect_all_symbols, find_callers as _find_callers
from structure import file_summary as _file_summary
from analysis import find_similar_code as _find_similar
from .synthesis import (
    _get_api_key, _claude_think, _local_think, _format_kb_corpus,
    _THINK_MODEL, _get_max_tokens, _get_effort, _get_tool_budget,
)
from . import _get_compositional_context, _track

logger = logging.getLogger("HME")

@ctx.mcp.tool()
def before_editing(file_path: str) -> str:
    """Call BEFORE editing any file. Assembles everything you need to know: KB constraints, callers, boundary rules, recent changes, and danger zones. One call replaces the entire pre-edit research workflow."""
    ctx.ensure_ready_sync()
    _track("before_editing")
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

    # 0. Recent git commits for this file (temporal context for Claude synthesis)
    _recent_commits = ""
    try:
        import subprocess as _sp
        _git = _sp.run(
            ["git", "-C", ctx.PROJECT_ROOT, "log", "--oneline", "-5", "--", rel_path],
            capture_output=True, text=True, timeout=3
        )
        if _git.stdout.strip():
            _recent_commits = _git.stdout.strip()
            parts.append("## Recent Commits")
            for line in _recent_commits.splitlines():
                parts.append(f"  {line}")
            parts.append("")
    except Exception:
        pass

    # 1. KB constraints — filtered for actual relevance to this module
    from . import _filter_kb_relevance
    kb_results = ctx.project_engine.search_knowledge(module_name, top_k=limits["kb_entries"])
    relevant_kb = _filter_kb_relevance(kb_results, module_name)
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
        with open(abs_path, encoding="utf-8", errors="ignore") as _f:
            content = _f.read()
        lines = content.split("\n")
        warnings = []
        if len(lines) > LINE_COUNT_WARN:
            warnings.append(f"OVERSIZE: {len(lines)} lines (target {LINE_COUNT_TARGET})")
        if "/crossLayer/" in rel_path:
            for dr in CROSSLAYER_BOUNDARY_VIOLATIONS:
                if dr in content and "conductorSignalBridge" not in content:
                    warnings.append(f"BOUNDARY VIOLATION: uses '{dr}' without conductorSignalBridge")
        for dry in DRY_PATTERNS:
            if dry["pattern"] in content and "crossLayerHelpers" not in os.path.basename(abs_path):
                warnings.append(dry["message"])
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

    # Musical context
    comp = _get_compositional_context(module_name)
    if comp:
        parts.append(f"\n## Musical Context (last run)")
        parts.append(comp)

    # Adaptive synthesis: what are the specific edit risks?
    callers_summary = ", ".join(caller_files[:8]) if caller_files else "none"
    kb_summary = "\n".join(
        f"  [{k['category']}] {k['title']}: {k['content'][:120]}"
        for k in relevant_kb
    ) if relevant_kb else "none"
    sym_summary = ""
    if not result.get("error") and result.get("symbols"):
        sym_summary = ", ".join(
            f"L{s['line']}:{s['name']}" for s in result["symbols"][:8]
        )
    user_text = (
        f"File about to be edited: {rel_path}\n"
        f"Dependents: {callers_summary}\n"
        f"Project KB constraints for this module:\n{kb_summary}\n"
        + (f"Recent commits: {_recent_commits[:200]}\n" if _recent_commits else "")
        + (f"Key symbols: {sym_summary}\n" if sym_summary else "")
        + (f"Musical context: {comp[:300]}\n" if comp else "")
        + "\nIn 3 numbered points: what are the specific risks of editing this file? "
        "Be concrete about which callers could break, which architectural boundaries apply, "
        "and any invariants (coupling targets, registration order, layer isolation) that must not change. "
        "If this module has musical impact, explain what the listener would notice if this code breaks."
    )
    api_key = _get_api_key()
    synthesis = None
    if api_key:
        synthesis = _claude_think(user_text, api_key, kb_context=_format_kb_corpus(),
                                   max_tool_calls=_get_tool_budget())
    if not synthesis:
        synthesis = _local_think(user_text, max_tokens=1024)
    if synthesis:
        parts.append(f"\n## Edit Risks *(adaptive)*")
        parts.append(synthesis)

    return "\n".join(parts)


@ctx.mcp.tool()
def what_did_i_forget(changed_files: str) -> str:
    """Call AFTER implementing changes, BEFORE running pipeline. Takes comma-separated file paths. Checks changed files against KB for missed constraints, boundary violations, and doc update needs. Output scales with remaining context window."""
    ctx.ensure_ready_sync()
    _track("what_did_i_forget")
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
            with open(abs_path, encoding="utf-8", errors="ignore") as _f:
                content = _f.read()
            if "/crossLayer/" in rel_path:
                for dr in CROSSLAYER_BOUNDARY_VIOLATIONS:
                    if dr in content and "conductorSignalBridge" not in content:
                        all_warnings.append(f"[{rel_path}] BOUNDARY: uses {dr} directly")
            # Check if new L0 channel was added (JS files only)
            if rel_path.endswith(".js") and "L0.post('" in content:
                import re
                channels = set(re.findall(r"L0\.post\('([^']+)'", content))
                for ch in channels:
                    if ch not in KNOWN_L0_CHANNELS:
                        all_warnings.append(f"[{rel_path}] NEW L0 CHANNEL: '{ch}' -- add to project-rules.json and narrative-digest/trace-summary consumers")
        except Exception:
            pass
        # Track doc update needs (path triggers from project-rules.json)
        for path_prefix, docs in DOC_UPDATE_TRIGGERS.items():
            if path_prefix in rel_path:
                for d in docs:
                    doc_updates_needed.add(d)

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

    # Adaptive synthesis: always run when API key available — missed things aren't only in warnings
    api_key = _get_api_key()
    if api_key:
        warnings_text = "\n".join(all_warnings[:15]) if all_warnings else "none"
        docs_text = ", ".join(sorted(doc_updates_needed)) if doc_updates_needed else "none flagged"
        user_text = (
            f"Changed files: {changed_files}\n"
            f"Audit warnings: {warnings_text}\n"
            f"Docs that may need updating: {docs_text}\n\n"
            "In 3 numbered points: what specific things might the developer have forgotten? "
            "Consider: registration requirements, doc sync, boundary rules, follow-on changes, "
            "and anything the warnings above don't capture."
        )
        synthesis = _claude_think(user_text, api_key, kb_context=_format_kb_corpus(),
                                   max_tool_calls=_get_tool_budget())
        if not synthesis:
            synthesis = _local_think(user_text, max_tokens=1024)
        if synthesis:
            parts.append(f"\n## What You May Have Missed *(adaptive)*")
            parts.append(synthesis)

    return "\n".join(parts)


@ctx.mcp.tool()
def diagnose_error(error_text: str) -> str:
    """Paste a pipeline error. Returns: likely source file, relevant KB entries, similar past bugs, and fix patterns."""
    ctx.ensure_ready_sync()
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
    # Also search global KB for cross-project patterns
    if ctx.global_engine:
        glob_hits = ctx.global_engine.search_knowledge(kb_query, top_k=2)
        kb_results.extend([dict(k, title=f"[global] {k['title']}") for k in glob_hits
                           if k["id"] not in {r["id"] for r in kb_results}])
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

    # Adaptive thinking synthesis: root cause + fix steps, KB grounded via corpus cache
    user_text = (
        f"Error:\n{error_text[:600]}\n\n"
        "Based on the error and the project KB, provide: "
        "(1) most likely root cause in one sentence, "
        "(2) exact fix steps as a numbered list, "
        "(3) any boundary/architectural rule to check."
    )
    api_key = _get_api_key()
    synthesis = None
    if api_key:
        synthesis = _claude_think(user_text, api_key, kb_context=_format_kb_corpus(),
                                   max_tool_calls=_get_tool_budget())
    if not synthesis:
        synthesis = _local_think(user_text, max_tokens=1024)
    if synthesis:
        parts.append(f"\n## Fix Synthesis *(adaptive)*")
        parts.append(synthesis)

    return "\n".join(parts)
