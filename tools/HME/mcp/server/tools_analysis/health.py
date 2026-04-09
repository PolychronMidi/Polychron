"""HME code health, convention, and analysis tools."""
import os
import logging
import re

from server import context as ctx
from . import _track
from server.helpers import (
    LINE_COUNT_TARGET, LINE_COUNT_WARN, LINE_COUNT_CRITICAL,
    CROSSLAYER_BOUNDARY_VIOLATIONS, DRY_PATTERNS,
    COUPLING_MATRIX_EXEMPT_PATHS, COUPLING_MATRIX_LEGACY_PATHS,
    KNOWN_NON_TOOL_IDENTIFIERS,
)
from .health_analysis import (
    _compute_iife_caller_counts, impact_analysis, convention_check,
    _symbol_exists_in_src, _HOT_PATH_FILES,
)

logger = logging.getLogger("HME")


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
            # Hot-path annotation: flag files that run on every beat
            hot = " [HOT PATH]" if any(h in item for h in _HOT_PATH_FILES) else ""
            parts.append(f"  - {item}{hot}")
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

    # KB-to-code freshness: check if KB entries reference modules that no longer exist
    try:
        all_kb = ctx.project_engine.list_knowledge_full() or []
        import glob as _glob
        src_modules = set()
        for _f in _glob.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", "*.js"), recursive=True):
            src_modules.add(os.path.basename(_f).replace(".js", ""))
        stale_kb = []
        _module_pat = re.compile(r'\b([a-z][a-zA-Z]{6,}(?:Engine|Manager|Guard|Detector|Regulator|Monitor|Tracker|Controller|Oscillator|Predictor|Avoider|Window|Transfer|Lock|Swap|Echo|Gravity|Mirror|Silhouette))\b')
        for entry in all_kb:
            text = entry.get("title", "") + " " + entry.get("content", "")
            refs = set(_module_pat.findall(text))
            missing = [r for r in refs if r not in src_modules and r.lower() not in {m.lower() for m in src_modules}
                       and not _symbol_exists_in_src(r, ctx.PROJECT_ROOT)]
            if missing:
                stale_kb.append(f"  [{entry.get('category','')}] {entry.get('title','')}: references {', '.join(missing[:3])}")
        if stale_kb:
            parts.append(f"\n## KB Staleness ({len(stale_kb)} entries reference missing modules)")
            for s in stale_kb[:8]:
                parts.append(s)
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
