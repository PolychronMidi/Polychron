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
    _local_think, compress_for_claude,
    _THINK_MODEL, _REASONING_MODEL, _LOCAL_MODEL, _get_max_tokens, _get_effort, _get_tool_budget,
    _THINK_SYSTEM, route_model,
)
from . import _get_compositional_context, _track
from .synthesis_session import append_session_narrative
from .tool_cache import cached_kb_search, cached_find_callers, _cache_set, _TTL_KB, _TTL_CALLERS

logger = logging.getLogger("HME")

# Synthesis cache — keyed (abs_path, mtime), eliminates repeated Ollama waits.
# Persisted to disk so cache survives server restarts. Stale entries (mtime mismatch)
# are silently dropped on load; valid entries are used immediately without re-synthesis.
_SYNTHESIS_CACHE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "before-editing-cache.json"
)


def _load_synthesis_cache_from_disk() -> dict:
    """Load persisted synthesis cache, filtering out entries whose mtime no longer matches."""
    try:
        with open(_SYNTHESIS_CACHE_PATH, "r", encoding="utf-8") as _f:
            raw = json.load(_f)
        valid = {}
        for key_str, synthesis in raw.items():
            try:
                abs_path, mtime_str = key_str.rsplit("::", 1)
                mtime = float(mtime_str)
                if os.path.exists(abs_path) and abs(os.path.getmtime(abs_path) - mtime) < 1.0:
                    valid[(abs_path, mtime)] = synthesis
            except Exception:
                continue
        logger.info(f"before-editing cache: loaded {len(valid)}/{len(raw)} valid entries from disk")
        return valid
    except FileNotFoundError:
        return {}
    except Exception as _e:
        logger.warning(f"before-editing cache: disk load failed ({_e}), starting empty")
        return {}


def _persist_synthesis_cache_entry(abs_path: str, mtime: float, synthesis: str) -> None:
    """Append one entry to the on-disk synthesis cache (non-blocking, best-effort)."""
    try:
        try:
            with open(_SYNTHESIS_CACHE_PATH, "r", encoding="utf-8") as _f:
                raw = json.load(_f)
        except (FileNotFoundError, json.JSONDecodeError):
            raw = {}
        raw[f"{abs_path}::{mtime}"] = synthesis
        # Prune entries whose source file has since changed mtime to keep the file lean.
        pruned = {k: v for k, v in raw.items() if _disk_entry_still_valid(k)}
        with open(_SYNTHESIS_CACHE_PATH, "w", encoding="utf-8") as _f:
            json.dump(pruned, _f, ensure_ascii=False, separators=(",", ":"))
    except Exception as _e:
        logger.debug(f"before-editing cache: disk write failed ({_e})")


def _disk_entry_still_valid(key_str: str) -> bool:
    try:
        abs_path, mtime_str = key_str.rsplit("::", 1)
        return os.path.exists(abs_path) and abs(os.path.getmtime(abs_path) - float(mtime_str)) < 1.0
    except Exception:
        return False


def _get_before_editing_cache() -> dict:
    if not hasattr(ctx, "_before_editing_synthesis_cache"):
        ctx._before_editing_synthesis_cache = _load_synthesis_cache_from_disk()
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
        except Exception:
            pass
        if not os.path.isfile(abs_path):
            _hint = (f"\nDid you mean?\n" + "\n".join(f"  {p}" for p in _did_you_mean)) if _did_you_mean else \
                    "\nUse find(query, mode='map') to find files by directory."
            return f"File not found: {abs_path}{_hint}"
    rel_path = abs_path.replace(os.path.realpath(ctx.PROJECT_ROOT) + "/", "")
    module_name = os.path.basename(abs_path).replace(".js", "").replace(".ts", "")

    # ── Data gathering (order determined by dependencies) ─────────────────

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
    except Exception:
        pass

    # KB constraints + callers — cached parallel fetch
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
            except Exception:
                pass
    except Exception:
        warnings.append("file unreadable")

    # File summary
    result = _file_summary(abs_path)

    # Musical context (needed by edit risks)
    comp = _get_compositional_context(module_name)

    # Edit risks synthesis
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
            _persist_synthesis_cache_entry(_cache_key[0], _cache_key[1], synthesis)

    hme_ctx = None
    if "tools/HME/" in rel_path and abs_path.endswith(".py"):
        _py_stem = os.path.basename(abs_path).replace(".py", "")
        hme_ctx = _hme_self_aware_context(abs_path, _py_stem)

    # ── Assembly: constraint-first order ──────────────────────────────────
    # Priority zone: constraints, warnings, bridges, edit risks (what will bite you)
    # Reference zone: dependents, structure, signals, evolutionary potential, context, commits

    parts = [f"# Before Editing: {rel_path} (context: {budget})\n"]

    # P1. KB Constraints — what you MUST NOT violate
    if relevant_kb:
        parts.append(f"## KB Constraints ({len(relevant_kb)} entries)")
        for k in relevant_kb:
            parts.append(f"  **[{k['category']}] {k['title']}**")
            parts.append(f"  {k['content'][:limits['kb_content']]}")
            parts.append("")
    else:
        parts.append("## KB Constraints: none found\n")

    # P2. Warnings — boundary violations you're at risk of
    if warnings:
        parts.append("## Warnings")
        for w in warnings:
            parts.append(f"  - {w}")
    else:
        parts.append("## Warnings: none")

    if hme_ctx:
        parts.append(f"\n## HME Internal Context")
        parts.append(hme_ctx)

    # P3. Antagonism Bridges — active coupling you must preserve
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
                    parts.append(f"  OPPORTUNITY r={b['r']:+.3f} vs {partner} — bridge via `{b['field']}`")
                    parts.append(f"    {b['eff_a']} | opposite: {b['eff_b']}")
                    parts.append(f"    {b['why']}")
    except Exception:
        pass

    # P4. Edit Risks — synthesized danger zones
    if synthesis:
        parts.append(f"\n## Edit Risks *(adaptive)*")
        parts.append(compress_for_claude(synthesis, max_chars=800,
                                         hint=f"edit risks for {rel_path}"))

    # ── Reference zone (below the fold) ──────────────────────────────────

    # R1. Dependents
    caller_limit = limits["callers"]
    parts.append(f"\n## Dependents ({len(caller_files)} files)")
    for f in caller_files[:caller_limit]:
        parts.append(f"  {f}")
    if len(caller_files) > caller_limit:
        parts.append(f"  ... and {len(caller_files) - caller_limit} more")

    # R2. Structure
    if not result.get("error"):
        sym_limit = limits["symbols"]
        parts.append(f"\n## Structure ({result.get('lines', '?')} lines)")
        if result.get("symbols"):
            for s in result["symbols"][:sym_limit]:
                sig = f" {s['signature']}" if s.get('signature') else ""
                parts.append(f"  L{s['line']}: [{s['kind']}] {s['name']}{sig}")
            if len(result["symbols"]) > sym_limit:
                parts.append(f"  ... and {len(result['symbols']) - sym_limit} more symbols")

    # R3. L0 Signal I/O
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
    except Exception:
        pass

    # R4. Evolutionary Potential
    if abs_path.endswith(".js") and "/src/" in abs_path:
        try:
            from .reasoning import build_evolutionary_potential
            evo_lines = build_evolutionary_potential(module_name)
            actionable = [l for l in evo_lines if "OPPORTUNITY" in l or "Unused" in l or "Not " in l]
            if actionable:
                parts.append(f"\n## Evolutionary Potential")
                parts.extend(evo_lines)
        except Exception:
            pass

    # R5. Musical Context
    if comp:
        parts.append(f"\n## Musical Context (last run)")
        parts.append(comp)

    # R6. Recent Commits
    if _recent_commits:
        parts.append(f"\n## Recent Commits")
        for line in _recent_commits.splitlines():
            parts.append(f"  {line}")

    return "\n".join(parts)


def _build_edit_risks(rel_path: str, caller_files: list, relevant_kb: list,
                      symbols: list | None, recent_commits: str, comp: str,
                      priority: str = "interactive") -> str | None:
    """Build and return the Edit Risks synthesis text. Shared by before_editing and warm_pre_edit_cache.
    Interactive calls use two-stage pipeline (extract→reason) for better grounding.
    Background/warm-cache calls use single-stage to avoid competing with interactive work."""
    callers_summary = ", ".join(caller_files[:8]) if caller_files else "none"
    kb_summary = "\n".join(
        f"  [{k['category']}] {k['title']}: {k['content'][:200]}"
        for k in relevant_kb
    ) if relevant_kb else "none"
    sym_summary = ""
    if symbols:
        sym_summary = ", ".join(f"L{s['line']}:{s['name']}" for s in symbols[:8])
    from .synthesis_session import get_session_narrative
    _session_ctx = get_session_narrative(max_entries=6, categories=["think", "find", "edit"])

    # Parallel two-stage for interactive calls with non-trivial context.
    # GPU0 (extract) + GPU1 (analyze) run simultaneously, ~2x faster than sequential.
    # Falls back to single-stage when there's nothing non-trivial to extract from.
    if priority == "interactive" and (caller_files or relevant_kb):
        from .synthesis_pipeline import _parallel_two_stage_think
        raw_context = (
            (_session_ctx if _session_ctx else "")
            + f"File being edited: {rel_path}\n"
            + (f"Key symbols: {sym_summary}\n" if sym_summary else "")
            + f"Dependents ({len(caller_files)}): {callers_summary}\n"
            + f"KB constraints:\n{kb_summary}\n"
            + (f"Recent commits: {recent_commits[:200]}\n" if recent_commits else "")
            + (f"Musical context: {comp[:300]}\n" if comp else "")
        )
        question = (
            f"What are the specific edit risks for {rel_path}? "
            "List 1-3 concrete edit risks, each naming the specific dependent file, "
            "boundary rule, or KB constraint. No generic advice. "
            "Format: '1. [risk] because [specific caller/constraint].'"
        )
        synthesis = _parallel_two_stage_think(raw_context, question, max_tokens=800)
        if synthesis:
            return synthesis

    # Single-stage fallback: leaf modules (0 callers, no KB), or background warm-cache calls.
    user_text = (
        (_session_ctx if _session_ctx else "")
        + f"File about to be edited: {rel_path}\n"
        f"Dependents ({len(caller_files)}): {callers_summary}\n"
        f"KB constraints:\n{kb_summary}\n"
        + (f"Recent commits: {recent_commits[:200]}\n" if recent_commits else "")
        + (f"Key symbols: {sym_summary}\n" if sym_summary else "")
        + (f"Musical context: {comp[:300]}\n" if comp else "")
        + "\nRules:\n"
        "- List 1-3 CONCRETE risks. Each must name the specific caller, boundary, or invariant.\n"
        "- Do NOT speculate about risks not grounded in the dependents and constraints above.\n"
        "- If this file has 0 dependents and no KB constraints, respond: 'Low risk — leaf module.'\n"
        "- Format: '1. [risk] because [specific caller/constraint].'\n"
    )
    synthesis = _local_think(user_text, max_tokens=800, model=route_model(user_text),
                             system=_THINK_SYSTEM, priority=priority)
    return synthesis


def _hme_self_aware_context(abs_path: str, py_stem: str) -> str | None:
    """Extra context when editing HME's own Python files."""
    import glob as _glob_mod
    import re as _re

    parts = []
    hme_mcp_dir = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "mcp")

    importers = []
    for py_file in _glob_mod.glob(os.path.join(hme_mcp_dir, "**", "*.py"), recursive=True):
        if py_file == abs_path:
            continue
        try:
            with open(py_file, encoding="utf-8", errors="ignore") as f:
                src = f.read(8000)
            rel = os.path.relpath(py_file, hme_mcp_dir)
            if _re.search(rf'from\s+\.{_re.escape(py_stem)}\s+import\b', src):
                importers.append(rel)
            elif _re.search(rf'from\s+server\.tools_analysis\.{_re.escape(py_stem)}\s+import\b', src):
                importers.append(rel)
        except Exception:
            continue
    if importers:
        parts.append(f"  Imported by: {', '.join(sorted(importers))}")

    try:
        from .evolution_selftest import RELOADABLE
        if py_stem in RELOADABLE:
            idx = RELOADABLE.index(py_stem)
            neighbors = []
            if idx > 0:
                neighbors.append(RELOADABLE[idx - 1])
            neighbors.append(f"**{py_stem}**")
            if idx < len(RELOADABLE) - 1:
                neighbors.append(RELOADABLE[idx + 1])
            parts.append(f"  RELOADABLE[{idx}/{len(RELOADABLE)}]: {' -> '.join(neighbors)}")
            for imp in importers:
                imp_stem = os.path.splitext(os.path.basename(imp))[0]
                if imp_stem in RELOADABLE:
                    imp_idx = RELOADABLE.index(imp_stem)
                    if imp_idx < idx:
                        parts.append(f"  RELOAD ORDER: {imp_stem}[{imp_idx}] loads before {py_stem}[{idx}] — reload both")
        else:
            parts.append(f"  NOT in RELOADABLE — hot-reload won't pick up changes")
    except Exception:
        pass

    try:
        with open(abs_path, encoding="utf-8", errors="ignore") as f:
            src = f.read()
        tools_found = _re.findall(r'@ctx\.mcp\.tool\(\)\n\s*def\s+(\w+)', src)
        if tools_found:
            parts.append(f"  MCP tools: {', '.join(tools_found)}")
    except Exception:
        pass

    try:
        log_dir = os.path.join(ctx.PROJECT_ROOT, "log")
        for log_name in ["hme.log", "hme_http.out"]:
            log_path = os.path.join(log_dir, log_name)
            if not os.path.isfile(log_path):
                continue
            import subprocess as _sp
            r = _sp.run(
                ["grep", "-in", py_stem, log_path],
                capture_output=True, text=True, timeout=2,
            )
            errors = [l for l in r.stdout.splitlines()
                      if any(kw in l.lower() for kw in ("error", "traceback", "exception", "failed"))]
            if errors:
                parts.append(f"  Recent errors in {log_name} ({len(errors)}):")
                for e in errors[-3:]:
                    parts.append(f"    {e.strip()[:120]}")
                break
    except Exception:
        pass

    return "\n".join(parts) if parts else None


@ctx.mcp.tool()
def warm_pre_edit_cache(max_files: int = 200, synthesis_hot: int = 30) -> str:
    """Pre-populate caches for src/ files so before_editing is instant.

    Fires in a background thread and returns immediately — never blocks Claude.
    Warms two cache tiers:
    - Tier 1 (all files): caller scan + KB hits — fast, covers max_files files
    - Tier 2 (hot files): Edit Risks synthesis via local model — covers synthesis_hot
      most recently modified files (highest chance of being edited next session)

    Returns confirmation that warming started (results logged to hme.log)."""
    import threading
    ctx.ensure_ready_sync()

    def _warm_background():
        try:
            result = _warm_pre_edit_cache_sync(max_files, synthesis_hot)
            logger.info(f"warm_pre_edit_cache (background): {result}")
        except Exception as e:
            logger.info(f"warm_pre_edit_cache (background) failed: {type(e).__name__}: {e}")

    threading.Thread(target=_warm_background, daemon=True, name="HME-warm-cache").start()
    return f"Cache warming started in background (max_files={max_files}, synthesis_hot={synthesis_hot}). Results in hme.log."


def _warm_pre_edit_cache_sync(max_files: int = 200, synthesis_hot: int = 30, target_hints: list = None) -> str:
    """Synchronous cache warming — called from background thread.

    target_hints: optional list of file paths or module names to prioritize at the
    front of the warming queue (Layer 11 intent propagation). Matching files are
    moved to the top of js_files before the max_files slice is applied.
    """
    import glob as _glob
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    js_files = _glob.glob(os.path.join(src_root, "**", "*.js"), recursive=True)
    js_files = [f for f in js_files if not f.endswith("index.js")]
    if target_hints:
        def _hint_priority(fpath):
            name = os.path.basename(fpath).replace(".js", "")
            return any(h in fpath or h in name for h in target_hints)
        js_files = sorted(js_files, key=_hint_priority, reverse=True)
    js_files = js_files[:max_files]
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
    # Early-abort: skip entire synthesis tier if Ollama cooldown is active.
    # Without this check, the sequential loop hammers _local_think for all hot_files
    # and generates one REFUSED log per file in ~40ms — pure noise.
    from .synthesis_ollama import _last_think_failure, _last_think_failure_ts, _TIMEOUT_COOLDOWN_S
    import time as _time_check
    if _last_think_failure == "timeout" and (_time_check.monotonic() - _last_think_failure_ts) < _TIMEOUT_COOLDOWN_S:
        _remaining_s = int(_TIMEOUT_COOLDOWN_S - (_time_check.monotonic() - _last_think_failure_ts))
        logger.info(f"warm_pre_edit_cache: synthesis tier skipped — Ollama cooldown active ({_remaining_s}s remaining).")
        return (f"Pre-edit cache warmed: {warmed} files (callers+KB). "
                f"Synthesis skipped — Ollama cooldown active ({_remaining_s}s remaining).")
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
        # Mid-loop cooldown check: abort synthesis tier if timeout fired during this warm run
        from .synthesis_ollama import _last_think_failure as _ltf, _last_think_failure_ts as _ltf_ts
        if _ltf == "timeout" and (_time_check.monotonic() - _ltf_ts) < _TIMEOUT_COOLDOWN_S:
            logger.info(f"warm_pre_edit_cache: synthesis aborted mid-loop — timeout fired. {synth_warmed} files warmed before abort.")
            break
        synthesis = _build_edit_risks(
            rel_path=rel_path, caller_files=caller_files, relevant_kb=relevant_kb,
            symbols=symbols, recent_commits="", comp="",
            priority="background",
        )
        if synthesis:
            _be_cache[_cache_key] = synthesis
            _persist_synthesis_cache_entry(_cache_key[0], _cache_key[1], synthesis)
            synth_warmed += 1
    return (f"Pre-edit cache warmed: {warmed} files (callers+KB). "
            f"Synthesis pre-loaded: {synth_warmed}/{len(hot_files)} hot files. "
            f"before_editing calls instant for all warmed files.")

