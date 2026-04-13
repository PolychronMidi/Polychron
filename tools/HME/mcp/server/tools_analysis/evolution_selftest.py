"""HME self-test and hot-reload — tool registration, doc sync, index integrity, Ollama health."""
import os
import logging
import sys
import importlib

from server import context as ctx
from .synthesis import _local_think
from . import _track

logger = logging.getLogger("HME")

# All reloadable tool modules (kept here so hme_selftest can inspect coverage via getsource).
RELOADABLE = [
    "synthesis", "synthesis_config", "synthesis_ollama",
    "synthesis_session", "synthesis_warm", "synthesis_pipeline",
    "warm_disk", "warm_persona",
    "tool_cache",
    "symbols", "workflow", "workflow_audit",
    "reasoning", "reasoning_think",
    "health",
    "evolution", "evolution_next", "evolution_suggest",
    "evolution_trace", "evolution_admin", "evolution_introspect", "evolution_selftest",
    "runtime", "composition", "trust_analysis",
    "digest", "digest_analysis",
    "section_compare", "perceptual", "perceptual_engines",
    "coupling_channels", "coupling_data", "coupling_clusters", "coupling_bridges", "coupling",
    "drama_map", "health_analysis", "section_labels",
    "evolution_evolve", "evolution_invariants", "search_unified", "review_unified",
    "read_unified", "learn_unified", "status_unified", "trace_unified",
    "todo", "enrich_prompt",
]
TOP_LEVEL_RELOADABLE = ["tools_search", "tools_knowledge"]
ROOT_RELOADABLE = ["file_walker", "lang_registry", "chunker"]


def hme_hot_reload(modules: str = "") -> str:
    """Hot-reload HME tool modules without restarting the server."""
    _track("hme_hot_reload")

    if not modules or modules.strip().lower() == "all":
        targets = RELOADABLE + TOP_LEVEL_RELOADABLE + ROOT_RELOADABLE
    else:
        targets = [m.strip() for m in modules.split(",") if m.strip()]

    inner = ctx.mcp._inner
    old_warn = inner._tool_manager.warn_on_duplicate_tools
    inner._tool_manager.warn_on_duplicate_tools = False

    results = []
    try:
        for name in targets:
            if name in ROOT_RELOADABLE:
                full = name
            elif name in TOP_LEVEL_RELOADABLE:
                full = f"server.{name}"
            else:
                full = f"server.tools_analysis.{name}"
            mod = sys.modules.get(full)
            if mod is None:
                try:
                    if name in ROOT_RELOADABLE:
                        mod = importlib.import_module(name)
                    elif name in TOP_LEVEL_RELOADABLE:
                        mod = importlib.import_module(f".{name}", "server")
                    else:
                        mod = importlib.import_module(f".{name}", "server.tools_analysis")
                    tools_new = {
                        tname for tname, t in inner._tool_manager._tools.items()
                        if getattr(t.fn, "__module__", "") == full
                           or getattr(getattr(t.fn, "__wrapped__", None), "__module__", "") == full
                    }
                    results.append(f"  NEW {name}: {len(tools_new)} tools loaded")
                except Exception as e:
                    results.append(f"  ERR {name} (import): {e}")
                continue
            try:
                tools_before = {
                    tname for tname, t in inner._tool_manager._tools.items()
                    if getattr(t.fn, "__module__", "") == full
                       or getattr(getattr(t.fn, "__wrapped__", None), "__module__", "") == full
                }
                remove_errs = []
                for tname in tools_before:
                    try:
                        inner.remove_tool(tname)
                    except Exception as _re:
                        remove_errs.append(f"{tname}:{_re}")
                if remove_errs:
                    results.append(f"  WARN remove errors for {name}: {remove_errs[:3]}")
                importlib.reload(mod)
                tools_after = {
                    tname for tname, t in inner._tool_manager._tools.items()
                    if getattr(t.fn, "__module__", "") == full
                       or getattr(getattr(t.fn, "__wrapped__", None), "__module__", "") == full
                }
                removed = tools_before - tools_after
                added = tools_after - tools_before
                status_str = f"{len(tools_after)} tools"
                if removed:
                    status_str += f" (-{len(removed)}: {', '.join(sorted(removed))})"
                if added:
                    status_str += f" (+{len(added)}: {', '.join(sorted(added))})"
                results.append(f"  OK {name}: {status_str} (was {len(tools_before)})")
            except Exception as e:
                results.append(f"  ERR {name}: {e}")
    finally:
        inner._tool_manager.warn_on_duplicate_tools = old_warn

    total_tools = len(inner._tool_manager._tools)
    return (
        f"## HME Hot Reload\n"
        + "\n".join(results)
        + f"\n\nTotal tools registered: {total_tools}"
    )


def hme_selftest() -> str:
    """Verify HME's own health: tool registration, doc sync, index integrity, Ollama, KB."""
    _track("hme_selftest")
    results = []

    tool_count = 0
    server_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for root, dirs, files in os.walk(server_root):
        for f in files:
            if f.endswith(".py"):
                try:
                    with open(os.path.join(root, f), encoding="utf-8") as _pyf:
                        for line in _pyf:
                            if line.strip() == "@ctx.mcp.tool()":
                                tool_count += 1
                except Exception:
                    pass
    results.append(f"{'PASS' if tool_count >= 8 else 'FAIL'}: {tool_count} tools registered")

    try:
        from .health import doc_sync_check
        sync = doc_sync_check("doc/HME.md")
        is_sync = "IN SYNC" in sync
        results.append(f"{'PASS' if is_sync else 'FAIL'}: doc sync -- {sync[:80]}")
    except Exception as e:
        results.append(f"FAIL: doc sync -- {e}")

    status: dict = {}
    try:
        ctx.ensure_ready_sync()
        status = ctx.project_engine.get_status()
        files = status.get("total_files", 0)
        chunks = status.get("total_chunks", 0)
        results.append(f"{'PASS' if files > 100 else 'FAIL'}: index -- {files} files, {chunks} chunks")
    except Exception as e:
        results.append(f"FAIL: index -- {e}")

    try:
        hashes = ctx.project_engine._file_hashes
        table_files = status.get("total_files", 0)
        hash_count = len(hashes)
        consistent = abs(hash_count - table_files) < 15
        if consistent:
            results.append(f"PASS: hash cache -- {hash_count} hashes vs {table_files} indexed files")
        else:
            results.append(
                f"WARN: hash cache -- {hash_count} hashes vs {table_files} indexed files "
                f"(stale entries from deleted/renamed files — fix: hme_admin(action='clear_index'))"
            )
    except Exception as e:
        results.append(f"FAIL: hash cache -- {e}")

    try:
        test = _local_think("respond with OK", max_tokens=5)
        results.append(f"{'PASS' if test else 'FAIL'}: Ollama -- {'connected' if test else 'no response'}")
    except Exception as e:
        results.append(f"FAIL: Ollama -- {e}")

    try:
        from .synthesis import warm_context_status, _ARBITER_MODEL
        wcs = warm_context_status()
        for model_name, info in wcs.items():
            if model_name in ("arbiter", "think_history", "session_narrative"):
                continue
            if isinstance(info, dict) and info.get("primed"):
                _tokens = info.get("tokens", 0)
                _age = info.get("age_s", 0)
                if _tokens < 100:
                    results.append(f"FAIL: warm ctx {model_name[:20]} -- claims primed but only {_tokens} tokens (priming likely failed)")
                elif _age > 3600:
                    results.append(f"WARN: warm ctx {model_name[:20]} -- {_tokens} tokens but {_age:.0f}s old (stale)")
                else:
                    results.append(
                        f"PASS: warm ctx {model_name[:20]} -- {_tokens} tokens, "
                        f"{'fresh' if info.get('kb_fresh') else 'STALE'}, {_age:.0f}s old"
                    )
            elif isinstance(info, dict):
                results.append(f"INFO: warm ctx {model_name[:20]} -- not primed (run hme_admin warm)")
        arbiter_info = wcs.get(_ARBITER_MODEL, {})
        arbiter_state = "primed" if isinstance(arbiter_info, dict) and arbiter_info.get("primed") else "not primed"
        results.append(f"INFO: arbiter ({_ARBITER_MODEL[:20]}) -- {arbiter_state}")
        results.append(f"INFO: think history -- {wcs.get('think_history', 0)} exchanges")
        results.append(f"INFO: session narrative -- {wcs.get('session_narrative', 0)} events")
    except Exception:
        results.append("INFO: warm ctx -- not available")

    try:
        kb = ctx.project_engine.list_knowledge()
        results.append(f"{'PASS' if len(kb) > 0 else 'WARN'}: KB -- {len(kb)} entries")
    except Exception as e:
        results.append(f"FAIL: KB -- {e}")

    # RELOADABLE completeness: every .py module in tools_analysis/ must be in the reload list
    try:
        _ta_dir = os.path.dirname(os.path.abspath(__file__))
        _all_modules = {
            f[:-3] for f in os.listdir(_ta_dir)
            if f.endswith(".py") and f != "__init__.py" and not f.startswith("_")
        }
        # Read RELOADABLE directly from module attributes (not from function source,
        # which doesn't contain the list definition).
        _in_list = set(RELOADABLE + TOP_LEVEL_RELOADABLE + ROOT_RELOADABLE)
        _missing = _all_modules - _in_list
        if _missing:
            results.append(f"FAIL: hot-reload coverage -- missing modules: {sorted(_missing)}")
        else:
            results.append(f"PASS: hot-reload coverage -- all {len(_all_modules)} modules in RELOADABLE")
    except Exception as e:
        results.append(f"WARN: hot-reload coverage -- check failed: {e}")

    try:
        from . import synthesis_ollama as _so
        if _so._last_think_failure == "timeout":
            import time as _ts_time
            _cooldown_remaining = max(0, _so._TIMEOUT_COOLDOWN_S - (_ts_time.monotonic() - _so._last_think_failure_ts))
            results.append(f"FAIL: Ollama cooldown -- timeout {int(_cooldown_remaining)}s remaining, synthesis calls blocked")
        elif _so._last_think_failure == "error":
            results.append(f"WARN: Ollama last failure -- non-timeout error (will retry)")
    except Exception:
        pass

    try:
        _log_path = os.path.join(ctx.PROJECT_ROOT, "log", "hme.log")
        if os.path.isfile(_log_path):
            import collections as _col
            _error_counts = _col.Counter()
            with open(_log_path, encoding="utf-8", errors="ignore") as _lf:
                _lines = _lf.readlines()[-200:]
            for _line in _lines:
                if " WARNING " in _line or " ERROR " in _line:
                    _msg = _line.split(" WARNING ", 1)[-1].split(" ERROR ", 1)[-1].strip()[:80]
                    _error_counts[_msg] += 1
            if _error_counts:
                _top = _error_counts.most_common(3)
                _total_errs = sum(_error_counts.values())
                results.append(f"WARN: hme.log -- {_total_errs} warnings/errors in last 200 lines:")
                for _msg, _count in _top:
                    results.append(f"  > ({_count}x) {_msg}")
            else:
                results.append("PASS: hme.log -- no warnings/errors in last 200 lines")
    except Exception:
        pass

    for name, target in [
        ("~/.claude/mcp/HME", "mcp symlink"),
        ("~/.claude/skills/HME", "skills symlink"),
    ]:
        path = os.path.expanduser(name)
        results.append(f"{'PASS' if os.path.islink(path) else 'FAIL'}: {target} -- {path}")

    passed = sum(1 for r in results if r.startswith("PASS"))
    failed = sum(1 for r in results if r.startswith("FAIL"))
    total = len(results)
    verdict = "READY" if failed == 0 else f"{failed} FAIL"
    header = f"## HME Self-Test: {passed}/{total} passed ({verdict})\n"
    return header + "\n".join(f"  {r}" for r in results)
