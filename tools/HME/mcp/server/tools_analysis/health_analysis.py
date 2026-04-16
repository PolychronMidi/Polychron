"""Health analysis helpers — compute-intensive functions extracted from health.py."""
import logging
import os
import re

from server import context as ctx
from server.helpers import (
    CROSSLAYER_BOUNDARY_VIOLATIONS, KNOWN_NON_TOOL_IDENTIFIERS,
    DRY_PATTERNS, REGISTRATION_PATTERNS,
    COUPLING_MATRIX_EXEMPT_PATHS, COUPLING_MATRIX_LEGACY_PATHS,
    LINE_COUNT_TARGET, LINE_COUNT_WARN, LINE_COUNT_CRITICAL,
)
from symbols import find_callers as _find_callers, find_iife_globals as _find_iife_globals
from analysis import trace_cross_language as _trace_cross_lang
from symbols import collect_all_symbols

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
    for fpath in walk_code_files():
        if not str(fpath).endswith(".js"):
            continue
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception as _err:
            logger.debug(f"unnamed-except health_analysis.py:52: {type(_err).__name__}: {_err}")
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

    for fpath in walk_code_files():
        if not (str(fpath).endswith(".js") or str(fpath).endswith(".ts")):
            continue
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception as _err:
            logger.debug(f"unnamed-except health_analysis.py:80: {type(_err).__name__}: {_err}")
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
    from server.helpers import validate_project_path
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
    # console.warn format — must be 'Acceptable warning: ...'
    warn_matches = re.findall(r'console\.warn\(([^\)]+)\)', content)
    for wm in warn_matches:
        if "Acceptable warning:" not in wm:
            issues.append(f"CONVENTION: console.warn must use 'Acceptable warning: ...' format.")
            break

    # Fallback patterns — ad-hoc || 0, || [], || '' instead of validator
    fallback_hits = re.findall(r'\|\|\s*(?:0(?:\.\d+)?|(?:\[\])|(?:\{\})|(?:["\']["\']))\b', content)
    if fallback_hits and "validator" not in content.lower():
        issues.append(f"CONVENTION: {len(fallback_hits)} fallback pattern(s) (|| 0, || [], etc). Use validator methods.")

    # Comment verbosity — JSDoc blocks and multi-line comments
    jsdoc_blocks = re.findall(r'/\*\*[\s\S]*?\*/', content)
    long_jsdoc = [b for b in jsdoc_blocks if b.count('\n') > 3]
    if long_jsdoc:
        issues.append(f"CONVENTION: {len(long_jsdoc)} verbose JSDoc block(s). Keep comments terse — one-line inline only.")

    # Self-registration check for src/ modules
    if rel_path.startswith("src/") and rel_path.endswith(".js") and "/index.js" not in rel_path:
        has_registration = any(p in content for p in REGISTRATION_PATTERNS)
        has_iife = "(function" in content or "(() =>" in content
        if not has_iife:
            issues.append("CONVENTION: No IIFE wrapper found. src/ modules should use (function(){...})() pattern.")
        if not has_registration and has_iife:
            # Only flag if file defines something (not a pure helper)
            if "module.exports" not in content and "= function" in content:
                issues.append("NOTE: No self-registration detected. If this module defines a global, it should self-register.")

    # File name vs export match
    fname_stem = os.path.basename(abs_path).replace(".js", "").replace(".ts", "")
    if rel_path.startswith("src/") and rel_path.endswith(".js") and "/index.js" not in rel_path:
        # Check if the IIFE assigns to a global matching the filename
        iife_assign = re.search(r'^\s*(\w+)\s*=\s*\(function', content, re.MULTILINE)
        if iife_assign:
            global_name = iife_assign.group(1)
            if global_name != fname_stem and global_name.lower() != fname_stem.lower():
                issues.append(f"CONVENTION: File '{fname_stem}' defines global '{global_name}'. Name should match.")

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
        for sfp in walk_code_files():
            srel = str(sfp).replace(ctx.PROJECT_ROOT + "/", "")
            if not srel.startswith("src/") or not srel.endswith(".js"):
                continue
            try:
                with open(sfp, encoding="utf-8", errors="ignore") as _sfpf:
                    sample_lines.append(sum(1 for _ in _sfpf))
            except Exception as _err:
                logger.debug(f"unnamed-except health_analysis.py:243: {type(_err).__name__}: {_err}")
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


def _symbol_exists_in_src(name: str, project_root: str) -> bool:
    """Check if a symbol name appears in any src/ JS file (as variable, function, etc)."""
    import subprocess
    try:
        result = subprocess.run(
            ["grep", "-rl", name, os.path.join(project_root, "src")],
            capture_output=True, text=True, timeout=5
        )
        return bool(result.stdout.strip())
    except Exception as _err:
        logger.debug(f"unnamed-except health_analysis.py:270: {type(_err).__name__}: {_err}")
        return False
