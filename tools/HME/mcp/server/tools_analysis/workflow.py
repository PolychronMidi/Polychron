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
    _local_think, compress_for_claude,
    _THINK_MODEL, _REASONING_MODEL, _LOCAL_MODEL, _get_max_tokens, _get_effort, _get_tool_budget,
    _THINK_SYSTEM,
)
from . import _get_compositional_context, _track

logger = logging.getLogger("HME")

# Synthesis cache — keyed (abs_path, mtime), eliminates repeated Ollama waits.
def _get_before_editing_cache() -> dict:
    if not hasattr(ctx, "_before_editing_synthesis_cache"):
        ctx._before_editing_synthesis_cache = {}
    return ctx._before_editing_synthesis_cache

# Caller cache — keyed (abs_path, mtime); file change auto-invalidates.
def _get_caller_cache() -> dict:
    if not hasattr(ctx, "_caller_cache"):
        ctx._caller_cache = {}
    return ctx._caller_cache

# KB hits cache — keyed (module_name, kb_version); knowledge write auto-invalidates.
def _get_kb_hits_cache() -> dict:
    if not hasattr(ctx, "_kb_hits_cache"):
        ctx._kb_hits_cache = {}
    return ctx._kb_hits_cache

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

    # 1+2. KB constraints + callers — cached parallel fetch (eliminates repeated scans)
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
        with _TPE(max_workers=2) as _pool:
            _kb_fut = _pool.submit(ctx.project_engine.search_knowledge, module_name, limits["kb_entries"])
            _cal_fut = _pool.submit(_find_callers, module_name, ctx.PROJECT_ROOT)
            kb_results = _kb_fut.result()
            _all_callers = _cal_fut.result()
        _caller_cache[_caller_key] = _all_callers
        _kb_cache[_kb_key] = kb_results
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
    callers = [r for r in _all_callers if module_name not in os.path.basename(r.get('file', ''))]
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

    # L0 Signal I/O — what channels this file reads and posts
    try:
        import re as _re
        with open(abs_path, encoding="utf-8", errors="ignore") as _mf:
            _src = _mf.read()
        _posts = sorted(set(_re.findall(r"L0\.post\('([^']+)'", _src)))
        _chan_vars = dict(_re.findall(r"const\s+(\w+)\s*=\s*'([^']+)'", _src))
        for _var, _ch in _chan_vars.items():
            if _re.search(r"L0\.post\(" + _re.escape(_var) + r"\b", _src):
                _posts = sorted(set(_posts + [_ch]))
        _reads = sorted(set(_re.findall(r"L0\.getLast\('([^']+)'", _src)))
        if _posts or _reads:
            parts.append(f"\n## L0 Signal I/O")
            if _posts:
                parts.append(f"  POSTS: {', '.join(_posts)}")
            if _reads:
                parts.append(f"  READS: {', '.join(_reads)}")
    except Exception:
        pass

    # Antagonism bridges — live r values, flag bridged vs virgin opportunities
    try:
        from .coupling import get_top_bridges, _TRUST_FILE_ALIASES, _FILE_TRUST_ALIASES
        trust_alias = _FILE_TRUST_ALIASES.get(module_name, module_name)
        # n=20 + threshold=-0.20: process all antagonist pairs so weak ones (e.g. r=-0.211) aren't
        # cut off before module-specific filtering. Global calls use default n=3/8 with -0.30.
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
                    parts.append(f"  OPPORTUNITY r={b['r']:+.3f} vs {partner} — bridge via `{b['field']}`")
                    parts.append(f"    {b['eff_a']} | opposite: {b['eff_b']}")
                    parts.append(f"    {b['why']}")
    except Exception:
        pass

    # Evolutionary Potential — fused from module_intel (R80 E4: one call gives everything)
    if abs_path.endswith(".js") and "/src/" in abs_path:
        try:
            from .reasoning import build_evolutionary_potential
            evo_lines = build_evolutionary_potential(module_name)
            if evo_lines:
                parts.append(f"\n## Evolutionary Potential")
                parts.extend(evo_lines)
        except Exception:
            pass

    # Musical context
    comp = _get_compositional_context(module_name)
    if comp:
        parts.append(f"\n## Musical Context (last run)")
        parts.append(comp)

    # Adaptive synthesis: what are the specific edit risks?
    # Cache by (abs_path, mtime) — reuse if file unchanged. warm_pre_edit_cache pre-populates this.
    try:
        _cache_key = (abs_path, os.path.getmtime(abs_path))
    except Exception:
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
    if synthesis:
        parts.append(f"\n## Edit Risks *(adaptive)*")
        # Compress via arbiter to ~600 chars — preserves file paths and action verbs,
        # strips prose explanation. Falls back to truncation if arbiter unavailable.
        parts.append(compress_for_claude(synthesis, max_chars=600,
                                         hint=f"edit risks for {rel_path}"))

    return "\n".join(parts)


def _build_edit_risks(rel_path: str, caller_files: list, relevant_kb: list,
                      symbols: list | None, recent_commits: str, comp: str,
                      priority: str = "interactive") -> str | None:
    """Build and return the Edit Risks synthesis text. Shared by before_editing and warm_pre_edit_cache.
    Uses local model for synthesis."""
    callers_summary = ", ".join(caller_files[:8]) if caller_files else "none"
    kb_summary = "\n".join(
        f"  [{k['category']}] {k['title']}: {k['content'][:120]}"
        for k in relevant_kb
    ) if relevant_kb else "none"
    sym_summary = ""
    if symbols:
        sym_summary = ", ".join(f"L{s['line']}:{s['name']}" for s in symbols[:8])
    user_text = (
        f"File about to be edited: {rel_path}\n"
        f"Dependents: {callers_summary}\n"
        f"Project KB constraints for this module:\n{kb_summary}\n"
        + (f"Recent commits: {recent_commits[:200]}\n" if recent_commits else "")
        + (f"Key symbols: {sym_summary}\n" if sym_summary else "")
        + (f"Musical context: {comp[:300]}\n" if comp else "")
        + "\nIn 3 numbered points: what are the specific risks of editing this file? "
        "Be concrete about which callers could break, which architectural boundaries apply, "
        "and any invariants (coupling targets, registration order, layer isolation) that must not change. "
        "If this module has musical impact, explain what the listener would notice if this code breaks."
    )
    # Local model: coder model handles 3-bullet edit risks well (~17-34s).
    synthesis = _local_think(user_text, max_tokens=250, model=_LOCAL_MODEL,
                             system=_THINK_SYSTEM, priority=priority)
    return synthesis


def warm_pre_edit_cache(max_files: int = 200, synthesis_hot: int = 30) -> str:
    """Pre-populate caches for src/ files so before_editing is instant.

    Warms two cache tiers:
    - Tier 1 (all files): caller scan + KB hits — fast, covers max_files files
    - Tier 2 (hot files): Edit Risks synthesis via local model — covers synthesis_hot
      most recently modified files (highest chance of being edited next session)

    Returns count of files warmed and synthesis hits pre-loaded."""
    ctx.ensure_ready_sync()
    import glob as _glob
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    js_files = _glob.glob(os.path.join(src_root, "**", "*.js"), recursive=True)
    js_files = [f for f in js_files if not f.endswith("index.js")][:max_files]
    _caller_cache = _get_caller_cache()
    _kb_cache = _get_kb_hits_cache()
    _be_cache = _get_before_editing_cache()
    kb_version = getattr(ctx, "_kb_version", 0)
    warmed = 0
    for fpath in js_files:
        module_name = os.path.basename(fpath).replace(".js", "")
        try:
            mtime = os.path.getmtime(fpath)
        except Exception:
            continue
        caller_key = (fpath, mtime)
        kb_key = (module_name, kb_version)
        if caller_key not in _caller_cache:
            _caller_cache[caller_key] = _find_callers(module_name, ctx.PROJECT_ROOT)
        if kb_key not in _kb_cache:
            _kb_cache[kb_key] = ctx.project_engine.search_knowledge(module_name, 8)
        warmed += 1
    # Tier 2: pre-synthesize Edit Risks for most recently modified files.
    # Uses Ollama queue with low priority — interactive calls (think, before_editing)
    # pop to top of stack via ollama_priority_call().
    hot_files = sorted(js_files, key=lambda f: os.path.getmtime(f) if os.path.exists(f) else 0, reverse=True)[:synthesis_hot]
    synth_warmed = 0
    from structure import file_summary as _fs
    for fpath in hot_files:
        try:
            mtime = os.path.getmtime(fpath)
        except Exception:
            continue
        _cache_key = (fpath, mtime)
        if _cache_key in _be_cache:
            continue
        module_name = os.path.basename(fpath).replace(".js", "")
        rel_path = fpath.replace(os.path.realpath(ctx.PROJECT_ROOT) + "/", "")
        kb_key = (module_name, kb_version)
        caller_key = (fpath, mtime)
        relevant_kb = _caller_cache.get(caller_key) and _kb_cache.get(kb_key) and []
        callers_raw = _caller_cache.get(caller_key) or []
        caller_files = sorted(set(r['file'].replace(ctx.PROJECT_ROOT + '/', '') for r in callers_raw
                                  if module_name not in os.path.basename(r.get('file', ''))))
        kb_results = _kb_cache.get(kb_key) or []
        from . import _filter_kb_relevance
        relevant_kb = _filter_kb_relevance(kb_results, module_name)
        try:
            sym_data = _fs(fpath)
            symbols = sym_data.get("symbols") if not sym_data.get("error") else None
        except Exception:
            symbols = None
        synthesis = _build_edit_risks(
            rel_path=rel_path, caller_files=caller_files, relevant_kb=relevant_kb,
            symbols=symbols, recent_commits="", comp="",
            priority="background",
        )
        if synthesis:
            _be_cache[_cache_key] = synthesis
            synth_warmed += 1
    return (f"Pre-edit cache warmed: {warmed} files (callers+KB). "
            f"Synthesis pre-loaded: {synth_warmed}/{len(hot_files)} hot files. "
            f"before_editing calls instant for all warmed files.")

