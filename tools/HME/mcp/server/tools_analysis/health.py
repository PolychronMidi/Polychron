"""HME code health, convention, and analysis tools."""
import os
import logging
import re

from server import context as ctx
from . import _track
from server.helpers import (
    get_context_budget, validate_project_path, fmt_score,
    format_knowledge_results, check_path_in_project,
    BUDGET_LIMITS, CROSSLAYER_BOUNDARY_VIOLATIONS, KNOWN_NON_TOOL_IDENTIFIERS,
    DRY_PATTERNS, REGISTRATION_PATTERNS,
    COUPLING_MATRIX_EXEMPT_PATHS, COUPLING_MATRIX_LEGACY_PATHS,
    LINE_COUNT_TARGET, LINE_COUNT_WARN, LINE_COUNT_CRITICAL,
)
from symbols import collect_all_symbols, find_callers as _find_callers, find_iife_globals as _find_iife_globals
from analysis import trace_cross_language as _trace_cross_lang
from structure import file_summary as _file_summary
from .synthesis import (
    _get_api_key, _think_local_or_claude, _format_kb_corpus,
    _THINK_MODEL, _get_tool_budget,
)

logger = logging.getLogger("HME")

# Files called on every beat — changes that affect these callers are highest-risk
_HOT_PATH_FILES = {
    "src/play/processBeat.js",
    "src/play/crossLayerBeatRecord.js",
    "src/play/emitPickCrossLayerRecord.js",
    "src/play/playNotesEmitPick.js",
    "src/play/main.js",
}


def _compute_iife_caller_counts(src_root: str, project_root: str) -> tuple[dict, dict, dict]:
    """Single-pass caller count for all IIFE globals.

    Returns:
      sym_files:  name → defining file path
      caller_counts: name → external caller count

    Algorithm:
      Pass 1 (src/ only): collect all IIFE global names and their defining files.
      Pass 2 (full project): read each file ONCE, find all symbol references
        simultaneously using a combined regex — O(files) not O(symbols × files).
    """
    from file_walker import walk_code_files

    # Pass 1 — collect symbols
    sym_files: dict[str, str] = {}
    sym_registrations: dict[str, bool] = {}
    _reg_pats = REGISTRATION_PATTERNS
    for fpath in walk_code_files(src_root):
        if not str(fpath).endswith(".js"):
            continue
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        iife_names = _find_iife_globals(content)
        for name in iife_names:
            sym_files[name] = str(fpath)
            # Check self-registration per symbol
            has_reg = any(
                f"{p}('{name}" in content or f'{p}("{name}' in content
                for p in _reg_pats
            )
            if not has_reg and len(iife_names) == 1:
                has_reg = any(p in content for p in _reg_pats)
            sym_registrations[name] = has_reg

    if not sym_files:
        return {}, {}, {}

    # Pass 2 — count references in one scan
    import re as _re
    name_list = list(sym_files.keys())
    combined = _re.compile(r'\b(' + '|'.join(_re.escape(n) for n in name_list) + r')\b')
    caller_counts: dict[str, int] = {n: 0 for n in name_list}

    for fpath in walk_code_files(project_root):
        if not (str(fpath).endswith(".js") or str(fpath).endswith(".ts")):
            continue
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        fpath_str = str(fpath)
        for m in combined.finditer(content):
            name = m.group(1)
            if fpath_str != sym_files.get(name, ""):
                caller_counts[name] = caller_counts.get(name, 0) + 1

    return sym_files, caller_counts, sym_registrations


def impact_analysis(symbol_name: str, language: str = "") -> str:
    """Analyze impact of changing a symbol: callers, references, KB constraints. Internal — call via module_intel(target, mode='impact')."""
    ctx.ensure_ready_sync()
    if not symbol_name.strip():
        return "Error: symbol_name cannot be empty."
    if len(symbol_name.strip()) < 2:
        return f"Error: symbol_name '{symbol_name}' too short (min 2 chars)."
    parts = []
    # Who calls this?
    callers = _find_callers(symbol_name, ctx.PROJECT_ROOT, lang_filter=language)
    # Filter out documentation files — .md mentions are not callers
    callers = [r for r in callers if not r['file'].endswith('.md')]
    caller_files = sorted(set(r['file'].replace(ctx.PROJECT_ROOT + '/', '') for r in callers))
    hot_callers = [f for f in caller_files if f in _HOT_PATH_FILES]
    parts.append(f"## Callers ({len(callers)} sites in {len(caller_files)} files)"
                 + (f" — {len(hot_callers)} HOT PATH" if hot_callers else ""))
    for f in caller_files[:15]:
        label = " [HOT PATH — per-beat execution]" if f in _HOT_PATH_FILES else ""
        parts.append(f"  {f}{label}")
    if len(caller_files) > 15:
        parts.append(f"  ... and {len(caller_files) - 15} more files")
    if hot_callers:
        parts.append(f"  !! This module is called from per-beat hot-path code — any signature or behavior change propagates on every beat.")
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


def convention_check(file_path: str) -> str:
    """Check a file against project conventions: line count, naming, registration, boundary rules."""
    ctx.ensure_ready_sync()
    abs_path = validate_project_path(file_path, ctx.PROJECT_ROOT)
    if abs_path is None:
        return f"Error: path '{file_path}' is outside the project root."
    if not os.path.isfile(abs_path):
        return f"File not found: {abs_path}"
    try:
        with open(abs_path, encoding="utf-8", errors="ignore") as _f:
            content = _f.read()
    except Exception as e:
        return f"Error reading {abs_path}: {e}"
    lines = content.split("\n")
    issues = []
    # Line count
    if len(lines) > LINE_COUNT_WARN:
        issues.append(f"WARN: {len(lines)} lines (target <= {LINE_COUNT_TARGET}). Consider extracting a helper.")
    elif len(lines) > LINE_COUNT_TARGET:
        issues.append(f"NOTE: {len(lines)} lines (target <= {LINE_COUNT_TARGET}). Approaching limit.")
    # Check for boundary violations (crossLayer reading conductor directly)
    rel_path = abs_path.replace(ctx.PROJECT_ROOT + "/", "")
    if "/crossLayer/" in rel_path:
        for dr in CROSSLAYER_BOUNDARY_VIOLATIONS:
            if dr in content and "conductorSignalBridge" not in content:
                issues.append(f"BOUNDARY: Uses '{dr}' without conductorSignalBridge. Route through bridge.")
    # Coupling firewall: .couplingMatrix reads only allowed in coupling engine, meta-controllers, profiler, diagnostics, pipeline
    if ".couplingMatrix" in content:
        if not any(ap in rel_path for ap in COUPLING_MATRIX_EXEMPT_PATHS):
            if any(lp in rel_path for lp in COUPLING_MATRIX_LEGACY_PATHS):
                issues.append(f"COUPLING FIREWALL: reads .couplingMatrix [legacy — tracked for refactor, not a blocker].")
            else:
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
                with open(sfp, encoding="utf-8", errors="ignore") as _sfpf:
                    sample_lines.append(sum(1 for _ in _sfpf))
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
    """Full codebase health sweep: architectural violations, dead code, convention checks, symbol importance, and doc sync. Replaces 5 separate health tools."""
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
        if line_count > LINE_COUNT_CRITICAL:
            issues_by_severity["CRITICAL"].append(f"{rel}: {line_count} lines (target {LINE_COUNT_TARGET})")
        elif line_count > LINE_COUNT_WARN:
            issues_by_severity["WARN"].append(f"{rel}: {line_count} lines")
        if "/crossLayer/" in rel:
            for dr in CROSSLAYER_BOUNDARY_VIOLATIONS:
                if dr in content and "conductorSignalBridge" not in content:
                    issues_by_severity["CRITICAL"].append(f"{rel}: boundary violation ({dr})")
                    break
        for dry in DRY_PATTERNS:
            if dry["pattern"] in content and "crossLayerHelpers" not in rel:
                issues_by_severity["WARN"].append(f"{rel}: {dry['message']}")
        # Coupling firewall — driven by project-rules.json (COUPLING_MATRIX_EXEMPT/LEGACY_PATHS)
        if ".couplingMatrix" in content:
            if not any(a in rel for a in COUPLING_MATRIX_EXEMPT_PATHS):
                if any(l in rel for l in COUPLING_MATRIX_LEGACY_PATHS):
                    issues_by_severity["WARN"].append(f"{rel}: coupling firewall violation (.couplingMatrix) [legacy — tracked for refactor]")
                else:
                    issues_by_severity["WARN"].append(f"{rel}: coupling firewall violation (.couplingMatrix)")
    # Partition CRITICAL issues: expected-large (data/generated) vs actionable
    _EXPECTED_LARGE = ("PriorsData.js", "Data.js", "globals.d.ts", "fullBootstrap.js")
    expected_large = [i for i in issues_by_severity["CRITICAL"] if any(p in i for p in _EXPECTED_LARGE)]
    actionable_critical = [i for i in issues_by_severity["CRITICAL"] if i not in expected_large]

    parts = [f"# Codebase Health Report ({file_count} src/ files)\n"]
    total_actionable = len(actionable_critical) + len(issues_by_severity["WARN"]) + len(issues_by_severity["NOTE"])
    total = sum(len(v) for v in issues_by_severity.values())
    if total == 0:
        parts.append("ALL CLEAN. No convention issues found.")
        return "\n".join(parts)

    if actionable_critical:
        # Sort by line count descending — worst offenders first
        def _extract_line_count(item: str) -> int:
            import re as _re
            m = _re.search(r"(\d+) lines", item)
            return int(m.group(1)) if m else 0
        actionable_critical_sorted = sorted(actionable_critical, key=_extract_line_count, reverse=True)
        parts.append(f"## CRITICAL — Actionable ({len(actionable_critical_sorted)})")
        for item in actionable_critical_sorted:
            parts.append(f"  - {item}")
        parts.append("")
    if expected_large:
        parts.append(f"## CRITICAL — Expected Large ({len(expected_large)}, data/generated — not split targets)")
        for item in sorted(expected_large):
            parts.append(f"  - {item}")
        parts.append("")
    for sev in ["WARN", "NOTE"]:
        items = issues_by_severity[sev]
        if items:
            parts.append(f"## {sev} ({len(items)})")
            for item in sorted(items):
                parts.append(f"  - {item}")
            parts.append("")
    parts.append(f"Total: {total} issues ({total_actionable} actionable, {len(expected_large)} expected-large) across {file_count} files")

    # Dead code sweep (top issues only)
    try:
        dead = find_dead_code()
        if "No dead code" not in dead:
            lines = dead.split("\n")
            parts.append("\n## Dead Code (top 5)")
            for l in lines[1:6]:
                parts.append(l)
    except Exception:
        pass

    # Symbol importance (top 10)
    try:
        importance = symbol_importance(top_n=10)
        lines = importance.split("\n")
        parts.append("\n## Symbol Importance (top 10)")
        for l in lines[1:12]:
            parts.append(l)
    except Exception:
        pass

    # Doc sync check
    try:
        sync = doc_sync_check()
        parts.append(f"\n## Doc Sync: {sync[:120]}")
    except Exception:
        pass

    return "\n".join(parts)


def find_dead_code(path: str = "src") -> str:
    """Scan all IIFE globals for zero external callers AND no conductor self-registration (truly dormant modules). Modules that self-register via conductorIntelligence.register* are active even without direct callers — their biases flow through the conductor signal pipeline via callbacks."""
    src_root = os.path.join(ctx.PROJECT_ROOT, path) if not os.path.isabs(path) else path
    sym_files, caller_counts, sym_registrations = _compute_iife_caller_counts(src_root, ctx.PROJECT_ROOT)

    dormant, active, self_registered = [], [], []
    for name, count in caller_counts.items():
        has_reg = sym_registrations.get(name, False)
        if count == 0 and not has_reg:
            rel = sym_files[name].replace(ctx.PROJECT_ROOT + '/', '')
            dormant.append(f"  {name} ({rel}) -- 0 external callers, no self-registration")
        elif count == 0 and has_reg:
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


def symbol_importance(top_n: int = 20) -> str:
    """Rank IIFE globals by caller count (architectural centrality). Most-called = most important."""
    src_root = os.path.join(ctx.PROJECT_ROOT, 'src')
    sym_files, caller_counts, _ = _compute_iife_caller_counts(src_root, ctx.PROJECT_ROOT)
    symbols = sorted(
        [(count, name, sym_files[name].replace(ctx.PROJECT_ROOT + '/', ''))
         for name, count in caller_counts.items()],
        key=lambda x: -x[0]
    )
    parts = [f"# Symbol Importance (top {top_n} by caller count)\n"]
    for i, (count, name, rel) in enumerate(symbols[:top_n]):
        parts.append(f"  {i+1}. {name}: {count} callers ({rel})")
    if len(symbols) > top_n:
        parts.append(f"\n  ... {len(symbols) - top_n} more symbols")
    parts.append(f"\nTotal: {len(symbols)} IIFE globals scanned")
    return "\n".join(parts)


def doc_sync_check(doc_path: str = "") -> str:
    """Check if a doc file is in sync with the codebase it describes. Finds stale references, missing tools, outdated counts."""
    target = doc_path if doc_path else os.path.join(ctx.PROJECT_ROOT, "doc/HME.md")
    abs_target = target if os.path.isabs(target) else os.path.join(ctx.PROJECT_ROOT, target)
    if not os.path.isfile(abs_target):
        return f"File not found: {abs_target}"
    with open(abs_target, encoding="utf-8", errors="ignore") as _f:
        doc_content = _f.read()
    issues = []
    # Check tool count claim
    count_match = re.search(r'(\d+)\s+(?:MCP\s+)?tools', doc_content)
    # Recursively scan all .py files under server/ for @ctx.mcp.tool decorators
    _server_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # health.py -> tools_analysis/ -> server/
    actual_tools = 0
    server_content_parts = []
    for _root, _dirs, _files in os.walk(_server_root):
        for _tf in _files:
            if not _tf.endswith(".py"):
                continue
            _tf_path = os.path.join(_root, _tf)
            try:
                with open(_tf_path, encoding="utf-8") as _f:
                    _lines = _f.readlines()
                actual_tools += sum(1 for l in _lines if l.strip() == "@ctx.mcp.tool()")
                server_content_parts.append("".join(_lines))
            except Exception:
                pass
    if count_match:
        claimed = int(count_match.group(1))
        # Accept "50+" style — only flag if exact count AND it's wrong
        if "50+" not in doc_content and claimed != actual_tools:
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
    # Read project-rules.json fresh at call time (module-level KNOWN_NON_TOOL_IDENTIFIERS is cached at import)
    try:
        import json as _json
        _rules_path = os.path.join(ctx.PROJECT_ROOT, "tools/HME/config/project-rules.json")
        with open(_rules_path) as _rf:
            _live_non_tools = frozenset(_json.load(_rf).get("known_non_tool_identifiers", []))
    except Exception:
        _live_non_tools = frozenset()
    known_non_tools = param_names | {
        "response_format", "file_type", "top_k", "top_n", "max_depth", "max_tokens",
        "file_path", "scope", "entry_id", "related_to", "relation_type",
    } | KNOWN_NON_TOOL_IDENTIFIERS | _live_non_tools  # relation_type values, KB categories, hook fields from project-rules.json
    # Only flag identifiers that look like they should be server tools
    tool_like = {t for t in doc_tool_refs if t.islower() and '_' in t and t not in server_fns and t not in known_non_tools and len(t) > 6}
    if tool_like:
        issues.append(f"MISSING: doc references tools not in server: {', '.join(sorted(tool_like))}")
    if not issues:
        return f"IN SYNC: {os.path.basename(abs_target)} matches server ({actual_tools} tools)"
    return f"OUT OF SYNC: {os.path.basename(abs_target)}\n" + "\n".join(f"  - {i}" for i in issues)


def symbol_audit(mode: str = "both", path: str = "src", top_n: int = 20) -> str:
    """Merged symbol analysis. mode: 'dead' (globals with 0 callers and no self-registration),
    'importance' (top-N IIFE globals by caller count, architectural centrality),
    or 'both' (default). Replaces calling find_dead_code + symbol_importance separately."""
    _track("symbol_audit")
    parts = []
    if mode in ("dead", "both"):
        parts.append(find_dead_code(path))
    if mode in ("importance", "both"):
        parts.append(symbol_importance(top_n))
    if not parts:
        return f"Unknown mode '{mode}'. Use 'dead', 'importance', or 'both'."
    return "\n\n".join(parts)
