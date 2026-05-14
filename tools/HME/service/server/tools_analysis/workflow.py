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

logger = logging.getLogger("HME")

# Synthesis cache -- keyed (abs_path, mtime), eliminates repeated llama.cpp waits.
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
            except Exception as _err:
                logger.debug(f"unnamed-except workflow.py:49: {type(_err).__name__}: {_err}")
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
    except Exception as _err:
        logger.debug(f"unnamed-except workflow.py:81: {type(_err).__name__}: {_err}")
        return False


def _get_before_editing_cache() -> dict:
    if not hasattr(ctx, "_before_editing_synthesis_cache"):
        ctx._before_editing_synthesis_cache = _load_synthesis_cache_from_disk()
    return ctx._before_editing_synthesis_cache

# Caller cache -- keyed (abs_path, mtime); file change auto-invalidates.
# Disk-backed via SQLite + in-RAM LRU. Replaces the in-process dict that
# capped warm-pre-edit-cache to ~200 src/ files per session AND lost
# everything across MCP restarts. With persistence, repeated warm calls
# accumulate coverage of every file the project has, not just the most
# recent 200.
def _get_caller_cache():
    if not hasattr(ctx, "_caller_cache"):
        from . import _disk_cache
        ctx._caller_cache = _disk_cache.get_cache(
            "caller", ctx.PROJECT_ROOT, ram_limit=256,
        )
    return ctx._caller_cache

# KB hits cache -- keyed (module_name, kb_version); knowledge write
# auto-invalidates via the kb_version component changing. Same
# disk-backed treatment.
def _get_kb_hits_cache():
    if not hasattr(ctx, "_kb_hits_cache"):
        from . import _disk_cache
        ctx._kb_hits_cache = _disk_cache.get_cache(
            "kb_hits", ctx.PROJECT_ROOT, ram_limit=256,
        )
    return ctx._kb_hits_cache


# Re-export -- before_editing extracted to sibling.
from .workflow_before_editing import before_editing  # noqa: F401, E402

def _build_edit_risks(rel_path: str, caller_files: list, relevant_kb: list,
                      symbols: list | None, recent_commits: str, comp: str,
                      priority: str = "interactive") -> str | None:
    """Build and return the Edit Risks synthesis text. Shared by before_editing and warm_pre_edit_cache.
    Interactive calls use two-stage pipeline (extract->reason) for better grounding.
    Background/warm-cache calls use single-stage to avoid competing with interactive work."""
    # Honor fast=true on read(): skip the 30-90s synthesis entirely when
    # the caller set HME_READ_FAST=1. Previously the flag only gated the
    # "Key Constraints" synthesis in reasoning.py, so native Read/Edit enrichment
    # still took 62s here -- the flag was effectively a lie for this path.
    if os.environ.get("HME_READ_FAST") in ("1", "true", "yes"):
        return "(Edit Risks synthesis skipped -- HME_READ_FAST=1)"
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
        "- If this file has 0 dependents and no KB constraints, respond: 'Low risk -- leaf module.'\n"
        "- Format: '1. [risk] because [specific caller/constraint].'\n"
    )
    # Risk analysis = multi-hop reasoning about caller/constraint impact.
    # Local reasoner's ceiling was the quality bottleneck here; escalate to
    # OVERDRIVE cascade, which falls back to local if every cloud slot is
    # exhausted. (The old `priority=` param was a local-scheduling hint --
    # cloud latency is independent of GPU queue state, so we drop it.)
    synthesis = _reasoning_think(user_text, max_tokens=800,
                                 system=_THINK_SYSTEM)
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
        except Exception as _err:
            logger.debug(f"unnamed-except workflow.py:440: {type(_err).__name__}: {_err}")
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
                        parts.append(f"  RELOAD ORDER: {imp_stem}[{imp_idx}] loads before {py_stem}[{idx}] -- reload both")
        else:
            parts.append(f"  NOT in RELOADABLE -- hot-reload won't pick up changes")
    except Exception as _err7:
        logger.debug(f"parts.append: {type(_err7).__name__}: {_err7}")

    try:
        with open(abs_path, encoding="utf-8", errors="ignore") as f:
            src = f.read()
        tools_found = _re.findall(r'@ctx\.mcp\.tool\(\)\n\s*def\s+(\w+)', src)
        if tools_found:
            parts.append(f"  MCP tools: {', '.join(tools_found)}")
    except Exception as _err8:
        logger.debug(f"parts.append: {type(_err8).__name__}: {_err8}")

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
    except Exception as _err9:
        logger.debug(f"break: {type(_err9).__name__}: {_err9}")

    return "\n".join(parts) if parts else None


def _warm_pre_edit_cache_sync(
    max_files: int = 2000,
    synthesis_hot: int = 30,
    target_hints: list = None,
    wall_clock_budget_s: float = 90.0,
) -> str:
    """Synchronous cache warming -- called from background thread.

    Tier-1 caches (callers + KB hits) are now disk-backed via
    _disk_cache.DiskCache; cached entries cost ~O(1) per check, so the
    historical max_files=200 cap (a per-call latency budget for in-RAM
    dicts that died on every restart) was raised to 2000 default. The
    wall-clock budget bounds total work per call so a fresh project with
    thousands of unwarmed files doesn't block the warm thread for
    minutes -- subsequent warm calls pick up from the disk cache and
    continue filling in coverage.

    target_hints: optional list of file paths or module names to prioritize at the
    front of the warming queue (Layer 11 intent propagation).
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
    # Cap by the (much higher) per-call budget; final coverage is
    # cumulative across calls thanks to disk persistence.
    js_files = js_files[:max_files]
    _caller_cache = _get_caller_cache()
    _kb_cache = _get_kb_hits_cache()
    _be_cache = _get_before_editing_cache()
    kb_version = getattr(ctx, "_kb_version", 0)
    warmed = 0
    import time as _time_warm
    _wall_start = _time_warm.monotonic()
    for fpath in js_files:
        if _time_warm.monotonic() - _wall_start > wall_clock_budget_s:
            logger.info(
                f"warm_pre_edit_cache: wall-clock budget {wall_clock_budget_s}s "
                f"exceeded after {warmed} files; remaining will be picked up on next warm call"
            )
            break
        module_name = os.path.basename(fpath).replace(".js", "")
        try:
            mtime = os.path.getmtime(fpath)
        except Exception as _err:
            logger.debug(f"unnamed-except workflow.py:526: {type(_err).__name__}: {_err}")
            continue
        caller_key = (fpath, mtime)
        kb_key = (module_name, kb_version)
        if caller_key not in _caller_cache:
            _caller_cache[caller_key] = _find_callers(module_name, ctx.PROJECT_ROOT)
        if kb_key not in _kb_cache:
            _kb_cache[kb_key] = ctx.project_engine.search_knowledge(module_name, 8)
        warmed += 1
    # Tier 2: pre-synthesize Edit Risks for most recently modified files.
    # Uses llama.cpp queue with low priority -- interactive calls (think, before_editing)
    # pop to top of stack via llamacpp_priority_call().
    hot_files = sorted(js_files, key=lambda f: os.path.getmtime(f) if os.path.exists(f) else 0, reverse=True)[:synthesis_hot]
    synth_warmed = 0
    # Early-abort: skip entire synthesis tier if llama.cpp cooldown is active.
    # Without this check, the sequential loop hammers _local_think for all hot_files
    # and generates one REFUSED log per file in ~40ms -- pure noise.
    from .synthesis_llamacpp import _last_think_failure, _last_think_failure_ts, _TIMEOUT_COOLDOWN_S
    import time as _time_check
    if _last_think_failure == "timeout" and (_time_check.monotonic() - _last_think_failure_ts) < _TIMEOUT_COOLDOWN_S:
        _remaining_s = int(_TIMEOUT_COOLDOWN_S - (_time_check.monotonic() - _last_think_failure_ts))
        logger.info(f"warm_pre_edit_cache: synthesis tier skipped -- llama.cpp cooldown active ({_remaining_s}s remaining).")
        return (f"Pre-edit cache warmed: {warmed} files (callers+KB). "
                f"Synthesis skipped -- llama.cpp cooldown active ({_remaining_s}s remaining).")
    from structure import file_summary as _fs
    for fpath in hot_files:
        try:
            mtime = os.path.getmtime(fpath)
        except Exception as _err:
            logger.debug(f"unnamed-except workflow.py:554: {type(_err).__name__}: {_err}")
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
        except Exception as _err:
            logger.debug(f"unnamed-except workflow.py:573: {type(_err).__name__}: {_err}")
            symbols = None
        # Mid-loop cooldown check: abort synthesis tier if timeout fired during this warm run
        from .synthesis_llamacpp import _last_think_failure as _ltf, _last_think_failure_ts as _ltf_ts
        if _ltf == "timeout" and (_time_check.monotonic() - _ltf_ts) < _TIMEOUT_COOLDOWN_S:
            logger.info(f"warm_pre_edit_cache: synthesis aborted mid-loop -- timeout fired. {synth_warmed} files warmed before abort.")
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
