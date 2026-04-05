"""HME code health, convention, and analysis tools."""
import os
import logging
import re

from server import context as ctx
from server.helpers import (
    get_context_budget, validate_project_path, fmt_score,
    format_knowledge_results, check_path_in_project,
    BUDGET_LIMITS, CROSSLAYER_BOUNDARY_VIOLATIONS,
)
from symbols import collect_all_symbols, find_callers as _find_callers, find_iife_globals as _find_iife_globals
from structure import file_summary as _file_summary
from .synthesis import (
    _get_api_key, _think_local_or_claude, _format_kb_corpus,
    _THINK_MODEL, _get_tool_budget,
)

logger = logging.getLogger("HyperMeta-Ecstasy")

@ctx.mcp.tool()
def impact_analysis(symbol_name: str, language: str = "") -> str:
    """Analyze the impact of changing a symbol: who calls it, what it calls, and knowledge constraints."""
    ctx.ensure_ready_sync()
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
    ctx.ensure_ready_sync()
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
        # Coupling firewall — mirrors COUPLING_MATRIX_EXEMPT_PATHS + COUPLING_MATRIX_LEGACY
        # from scripts/pipeline/check-hypermeta-jurisdiction.js
        if ".couplingMatrix" in content:
            exempt = [
                "/conductor/signal/balancing/", "/conductor/signal/profiling/",
                "/conductor/signal/meta/", "/conductor/signal/output/",
                "conductorDiagnostics", "/scripts/pipeline/", "/writer/traceDrain",
                "play/processBeat.js",
            ]
            legacy = [
                "phaseLockedRhythmGenerator.js", "conductorDampening.js",
                "densityWaveAnalyzer.js", "velocityShapeAnalyzer.js",
                "play/crossLayerBeatRecord.js", "play/main.js",
            ]
            if not any(a in rel for a in exempt):
                if any(l in rel for l in legacy):
                    issues_by_severity["WARN"].append(f"{rel}: coupling firewall violation (.couplingMatrix) [legacy — tracked for refactor]")
                else:
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

    if total > 0:
        critical_list = "\n".join(issues_by_severity["CRITICAL"][:10]) or "none"
        warn_list = "\n".join(issues_by_severity["WARN"][:10]) or "none"
        user_text = (
            f"Codebase health sweep found {total} issues across {file_count} files.\n"
            f"CRITICAL:\n{critical_list}\nWARN:\n{warn_list}\n\n"
            "In 3 numbered points: which issues are highest-priority to address first, and why? "
            "Consider architectural risk, coupling exposure, and technical debt accumulation."
        )
        synthesis = _think_local_or_claude(user_text, _get_api_key())
        if synthesis:
            parts.append(f"\n## Priority Analysis *(adaptive)*")
            parts.append(synthesis)

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
    target = doc_path if doc_path else os.path.join(ctx.PROJECT_ROOT, "doc/HyperMeta-Ecstasy.md")
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
    known_non_tools = param_names | {
        "response_format", "file_type", "top_k", "top_n", "max_depth", "max_tokens",
        "file_path", "scope", "entry_id", "related_to", "relation_type",
        # relation_type enum values (appear backticked in docs)
        "caused_by", "fixed_by", "depends_on", "contradicts", "similar_to", "supersedes",
        # KB category values
        "architecture", "decision", "pattern", "bugfix",
    }
    # Only flag identifiers that look like they should be server tools
    tool_like = {t for t in doc_tool_refs if t.islower() and '_' in t and t not in server_fns and t not in known_non_tools and len(t) > 6}
    if tool_like:
        issues.append(f"MISSING: doc references tools not in server: {', '.join(sorted(tool_like))}")
    if not issues:
        return f"IN SYNC: {os.path.basename(abs_target)} matches server ({actual_tools} tools)"
    return f"OUT OF SYNC: {os.path.basename(abs_target)}\n" + "\n".join(f"  - {i}" for i in issues)
