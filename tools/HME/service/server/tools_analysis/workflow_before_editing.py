"""HME pre/post-edit workflow tools."""
import os
import json
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
    _local_think, _reasoning_think, compress_for_claude,
    _THINK_MODEL, _LOCAL_MODEL, _get_max_tokens, _get_effort, _get_tool_budget,
    _THINK_SYSTEM, route_model,
)
from . import _get_compositional_context, _track
from .synthesis_session import append_session_narrative
from .tool_cache import cached_kb_search, cached_find_callers, _cache_set, _TTL_KB, _TTL_CALLERS

# workflow.py imports US at line 106, so a top-level back-import would
def _build_edit_risks(*a, **kw):
    from . import workflow as _w; return _w._build_edit_risks(*a, **kw)
def _hme_self_aware_context(*a, **kw):
    from . import workflow as _w; return _w._hme_self_aware_context(*a, **kw)
def _persist_synthesis_cache_entry(*a, **kw):
    from . import workflow as _w; return _w._persist_synthesis_cache_entry(*a, **kw)
def _get_before_editing_cache():
    from . import workflow as _w; return _w._get_before_editing_cache()
def _get_caller_cache():
    from . import workflow as _w; return _w._get_caller_cache()
def _get_kb_hits_cache():
    from . import workflow as _w; return _w._get_kb_hits_cache()

logger = logging.getLogger("HME")

# Synthesis cache -- keyed (abs_path, mtime), eliminates repeated llama.cpp waits.
_SYNTHESIS_CACHE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "before-editing-cache.json"
)




def before_editing(file_path: str) -> str:
    """Call BEFORE editing any file. Assembles everything you need to know: KB constraints, callers, boundary rules, recent changes, and danger zones. One call replaces the entire pre-edit research workflow."""
    ctx.ensure_ready_sync()
    _track("before_editing")
    append_session_narrative("before_editing", file_path.strip()[:80])
    if not file_path or not file_path.strip():
        return "Error: file_path cannot be empty. Pass the relative or absolute path to the file you are about to edit."
    budget = get_context_budget()
    limits = BUDGET_LIMITS[budget]
    abs_path = validate_project_path(file_path, ctx.PROJECT_ROOT)
    if abs_path is None:
        return f"Error: path '{file_path}' is outside the project root."
    if not os.path.isfile(abs_path):
        # Auto-resolve module names: try adding .js and searching src/
        _basename = os.path.basename(file_path.strip())
        _did_you_mean = []
        try:
            import glob as _glob
            # Try exact basename first, then with .js extension
            for _pattern in [_basename, f"{_basename}.js", f"{_basename}.ts", f"{_basename}.py"]:
                _candidates = _glob.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", _pattern), recursive=True)
                if not _candidates:
                    _candidates = _glob.glob(os.path.join(ctx.PROJECT_ROOT, "**", _pattern), recursive=True)
                if _candidates:
                    # If exactly one match, auto-resolve instead of suggesting
                    if len(_candidates) == 1:
                        abs_path = _candidates[0]
                        break
                    _did_you_mean = [c.replace(ctx.PROJECT_ROOT + "/", "") for c in _candidates[:5]]
                    break
        except Exception as _err1:
            logger.debug(f"break: {type(_err1).__name__}: {_err1}")
        if not os.path.isfile(abs_path):
            _hint = (f"\nDid you mean?\n" + "\n".join(f"  {p}" for p in _did_you_mean)) if _did_you_mean else \
                    "\nUse find(query, mode='map') to find files by directory."
            return f"File not found: {abs_path}{_hint}"
    rel_path = abs_path.replace(os.path.realpath(ctx.PROJECT_ROOT) + "/", "")
    module_name = os.path.basename(abs_path).replace(".js", "").replace(".ts", "")

    # Data gathering (order determined by dependencies)

    # Git commits (needed by edit risks synthesis)
    _recent_commits = ""
    try:
        import subprocess as _sp
        _git = _sp.run(
            ["git", "-C", ctx.PROJECT_ROOT, "log", "--oneline", "-5", "--", rel_path],
            capture_output=True, text=True, timeout=3
        )
        if _git.stdout.strip():
            _recent_commits = _git.stdout.strip()
    except Exception as _err2:
        logger.debug(f"_git.stdout.strip: {type(_err2).__name__}: {_err2}")

    # KB constraints + callers -- cached parallel fetch
    from . import _filter_kb_relevance
    _caller_cache = _get_caller_cache()
    _kb_cache = _get_kb_hits_cache()
    _caller_key = (abs_path, os.path.getmtime(abs_path) if os.path.isfile(abs_path) else 0)
    _kb_key = (module_name, getattr(ctx, "_kb_version", 0))
    if _caller_key in _caller_cache and _kb_key in _kb_cache:
        _all_callers = _caller_cache[_caller_key]
        kb_results = _kb_cache[_kb_key]
    else:
        from concurrent.futures import ThreadPoolExecutor as _TPE
        import concurrent.futures as _cf
        with _TPE(max_workers=2) as _pool:
            _kb_fut = _pool.submit(ctx.project_engine.search_knowledge, module_name, limits["kb_entries"])
            _cal_fut = _pool.submit(_find_callers, module_name, ctx.PROJECT_ROOT)
            # Bounded waits: unbounded .result() would block forever if the
            try:
                kb_results = _kb_fut.result(timeout=30)
            except _cf.TimeoutError:
                logger.warning(f"before_editing: search_knowledge({module_name}) >30s -- empty KB fallback")
                kb_results = []
            try:
                _all_callers = _cal_fut.result(timeout=30)
            except _cf.TimeoutError:
                logger.warning(f"before_editing: _find_callers({module_name}) >30s -- empty callers fallback")
                _all_callers = []
        _caller_cache[_caller_key] = _all_callers
        _kb_cache[_kb_key] = kb_results
        from server import context as _ctx
        _cache_set(("kb", id(_ctx.project_engine), module_name[:120], limits["kb_entries"]), kb_results, _TTL_KB)
        _cache_set(("callers", module_name, _ctx.PROJECT_ROOT), _all_callers, _TTL_CALLERS)
    relevant_kb = _filter_kb_relevance(kb_results, module_name)

    callers = [r for r in _all_callers if module_name not in os.path.basename(r.get('file', ''))]
    caller_files = sorted(set(r['file'].replace(ctx.PROJECT_ROOT + '/', '') for r in callers))

    # File content + conventions
    content = ""
    warnings: list[str] = []
    try:
        with open(abs_path, encoding="utf-8", errors="ignore") as _f:
            content = _f.read()
        file_lines = content.split("\n")
        if len(file_lines) > LINE_COUNT_WARN:
            warnings.append(f"OVERSIZE: {len(file_lines)} lines (target {LINE_COUNT_TARGET})")
        if "/crossLayer/" in rel_path:
            for dr in CROSSLAYER_BOUNDARY_VIOLATIONS:
                if dr in content and "conductorSignalBridge" not in content:
                    warnings.append(f"BOUNDARY VIOLATION: uses '{dr}' without conductorSignalBridge")
        for dry in DRY_PATTERNS:
            if dry["pattern"] in content and "crossLayerHelpers" not in os.path.basename(abs_path):
                warnings.append(dry["message"])
        # Python static bug scan for HME server files being edited
        if abs_path.endswith(".py"):
            try:
                from .workflow_audit import _scan_python_bug_patterns as _sbp
                for _pw in _sbp(rel_path, content):
                    warnings.append(_pw)
            except Exception as _err3:
                logger.debug(f"warnings.append: {type(_err3).__name__}: {_err3}")
    except Exception as _err:
        logger.debug(f"unnamed-except workflow.py:206: {type(_err).__name__}: {_err}")
        warnings.append("file unreadable")

    # File summary
    result = _file_summary(abs_path)

    # Musical context (needed by edit risks)
    comp = _get_compositional_context(module_name)

    # Edit risks synthesis
    try:
        _cache_key = (abs_path, os.path.getmtime(abs_path))
    except Exception as _err:
        logger.debug(f"unnamed-except workflow.py:218: {type(_err).__name__}: {_err}")
        _cache_key = (abs_path, 0)
    _be_cache = _get_before_editing_cache()
    synthesis = _be_cache.get(_cache_key)
    if synthesis is None:
        synthesis = _build_edit_risks(
            rel_path=rel_path, caller_files=caller_files, relevant_kb=relevant_kb,
            symbols=result.get("symbols") if not result.get("error") else None,
            recent_commits=_recent_commits, comp=comp,
        )
        if synthesis:
            _be_cache[_cache_key] = synthesis
            _persist_synthesis_cache_entry(_cache_key[0], _cache_key[1], synthesis)

    hme_ctx = None
    if "tools/HME/" in rel_path and abs_path.endswith(".py"):
        _py_stem = os.path.basename(abs_path).replace(".py", "")
        hme_ctx = _hme_self_aware_context(abs_path, _py_stem)

    # Assembly: constraint-first order

    parts = [f"# Before Editing: {rel_path} (context: {budget})\n"]

    # P1. KB Constraints -- what you MUST NOT violate
    if relevant_kb:
        parts.append(f"## KB Constraints ({len(relevant_kb)} entries)")
        for k in relevant_kb:
            parts.append(f"  **[{k['category']}] {k['title']}**")
            parts.append(f"  {k['content'][:limits['kb_content']]}")
            parts.append("")
    else:
        parts.append("## KB Constraints: none found\n")

    # P2. Warnings -- boundary violations you're at risk of
    if warnings:
        parts.append("## Warnings")
        for w in warnings:
            parts.append(f"  - {w}")
    else:
        parts.append("## Warnings: none")

    if hme_ctx:
        parts.append(f"\n## HME Internal Context")
        parts.append(hme_ctx)

    # P3. Antagonism Bridges -- active coupling you must preserve
    try:
        from .coupling import get_top_bridges, _TRUST_FILE_ALIASES, _FILE_TRUST_ALIASES
        trust_alias = _FILE_TRUST_ALIASES.get(module_name, module_name)
        bridges = get_top_bridges(n=20, threshold=-0.20)
        def _is_this_mod(name: str) -> bool:
            return (name == module_name or name == trust_alias
                    or _TRUST_FILE_ALIASES.get(name, name) == module_name)
        my_bridges = [b for b in bridges if _is_this_mod(b["pair_a"]) or _is_this_mod(b["pair_b"])]
        if my_bridges:
            parts.append(f"\n## Antagonism Bridges ({len(my_bridges)} pairs involve this module)")
            for b in my_bridges[:3]:
                partner_raw = b["pair_b"] if _is_this_mod(b["pair_a"]) else b["pair_a"]
                partner = _TRUST_FILE_ALIASES.get(partner_raw, partner_raw)
                if b["already_bridged"]:
                    parts.append(f"  BRIDGED r={b['r']:+.3f} vs {partner} (via {', '.join(b['already_bridged'])})")
                else:
                    parts.append(f"  OPPORTUNITY r={b['r']:+.3f} vs {partner} -- bridge via `{b['field']}`")
                    parts.append(f"    {b['eff_a']} | opposite: {b['eff_b']}")
                    parts.append(f"    {b['why']}")
    except Exception as _err4:
        logger.debug(f"parts.append: {type(_err4).__name__}: {_err4}")

    # P4. Edit Risks -- synthesized danger zones
    _verbose = os.environ.get("HME_READ_VERBOSE", "0") == "1"
    if synthesis and _verbose:
        parts.append(f"\n## Edit Risks *(adaptive)*")
        parts.append(compress_for_claude(synthesis, max_chars=800,
                                         hint=f"edit risks for {rel_path}"))

    # Reference zone -- dependents/structure/signals/evolutionary/musical/commits
    if _verbose:
        caller_limit = limits["callers"]
        parts.append(f"\n## Dependents ({len(caller_files)} files)")
        for f in caller_files[:caller_limit]:
            parts.append(f"  {f}")
        if len(caller_files) > caller_limit:
            parts.append(f"  ... and {len(caller_files) - caller_limit} more")

        if not result.get("error"):
            sym_limit = limits["symbols"]
            parts.append(f"\n## Structure ({result.get('lines', '?')} lines)")
            if result.get("symbols"):
                for s in result["symbols"][:sym_limit]:
                    sig = f" {s['signature']}" if s.get('signature') else ""
                    parts.append(f"  L{s['line']}: [{s['kind']}] {s['name']}{sig}")
                if len(result["symbols"]) > sym_limit:
                    parts.append(f"  ... and {len(result['symbols']) - sym_limit} more symbols")

        try:
            import re as _re
            _posts = sorted(set(_re.findall(r"L0\.post\('([^']+)'", content)))
            _chan_vars = dict(_re.findall(r"const\s+(\w+)\s*=\s*'([^']+)'", content))
            for _var, _ch in _chan_vars.items():
                if _re.search(r"L0\.post\(" + _re.escape(_var) + r"\b", content):
                    _posts = sorted(set(_posts + [_ch]))
            _reads = sorted(set(_re.findall(r"L0\.getLast\('([^']+)'", content)))
            if _posts or _reads:
                parts.append(f"\n## L0 Signal I/O")
                if _posts:
                    parts.append(f"  POSTS: {', '.join(_posts)}")
                if _reads:
                    parts.append(f"  READS: {', '.join(_reads)}")
        except Exception as _err5:
            logger.debug(f"parts.append: {type(_err5).__name__}: {_err5}")

        if abs_path.endswith(".js") and "/src/" in abs_path:
            try:
                from .reasoning import build_evolutionary_potential
                evo_lines = build_evolutionary_potential(module_name)
                actionable = [l for l in evo_lines if "OPPORTUNITY" in l or "Unused" in l or "Not " in l]
                if actionable:
                    parts.append(f"\n## Evolutionary Potential")
                    parts.extend(evo_lines)
            except Exception as _err6:
                logger.debug(f"parts.extend: {type(_err6).__name__}: {_err6}")

        if comp:
            parts.append(f"\n## Musical Context (last run)")
            parts.append(comp)

        if _recent_commits:
            parts.append(f"\n## Recent Commits")
            for line in _recent_commits.splitlines():
                parts.append(f"  {line}")
    else:
        # Terse footer so the agent knows there's more on demand.
        parts.append(
            f"\n_Reference sections (dependents/structure/L0/musical/commits) "
            f"suppressed by default -- set HME_READ_VERBOSE=1 to include them._"
        )

    return "\n".join(parts)


