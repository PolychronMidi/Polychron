"""HME self-test and hot-reload — tool registration, doc sync, index integrity, llama.cpp health."""
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
    "synthesis", "synthesis_config", "synthesis_llamacpp", "synthesis_gemini",
    "synthesis_groq", "synthesis_openrouter", "synthesis_cerebras",
    "synthesis_mistral", "synthesis_nvidia", "synthesis_reasoning",
    "synthesis_session", "synthesis_warm", "synthesis_pipeline",
    "request_coordinator",
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
    "todo", "enrich_prompt", "tools_passthru", "activity_digest", "blindspots",
    "cascade_analysis",
]
TOP_LEVEL_RELOADABLE = ["tools_search", "tools_knowledge", "llamacpp_supervisor"]
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
    """Verify HME's own health: tool registration, doc sync, index integrity, llama.cpp, KB."""
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
                except Exception as _err1:
                    logger.debug(f"1: {type(_err1).__name__}: {_err1}")
    results.append(f"{'PASS' if tool_count >= 6 else 'FAIL'}: {tool_count} tools registered")

    try:
        from .health import doc_sync_check
        sync = doc_sync_check("doc/HME.md")
        is_sync = "IN SYNC" in sync
        results.append(f"{'PASS' if is_sync else 'FAIL'}: doc sync -- {sync[:80]}")
    except Exception as e:
        results.append(f"FAIL: doc sync -- {e}")

    # Doc-code stale-reference verifier (catches legacy tool name drift across
    # all doc/*.md files, not just HME.md). Runs as a subprocess so a broken
    # verifier can't crash the selftest.
    _project_root = os.environ.get("PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    )
    try:
        import subprocess
        verifier = os.path.join(_project_root, "tools", "HME", "scripts", "verify-doc-sync.py")
        if os.path.isfile(verifier):
            rc = subprocess.run(
                ["python3", verifier],
                capture_output=True, text=True, timeout=30,
                env={**os.environ, "PROJECT_ROOT": _project_root},
            )
            hits = None
            for ln in rc.stdout.splitlines():
                if ln.startswith("Drift hits:"):
                    try:
                        hits = int(ln.split(":", 1)[1].strip())
                    except ValueError:
                        pass
                    break
            if hits is None:
                results.append("WARN: doc stale-ref scan -- could not parse verifier output")
            elif hits == 0:
                results.append("PASS: doc stale-ref scan -- no legacy tool references detected")
            else:
                results.append(f"FAIL: doc stale-ref scan -- {hits} legacy tool reference(s) detected (run tools/HME/scripts/verify-doc-sync.py for details)")
        else:
            results.append("INFO: doc stale-ref scan -- verifier script not found")
    except Exception as e:
        results.append(f"WARN: doc stale-ref scan -- {e}")

    # Onboarding flow dry-run — simulates a full walkthrough in isolation and
    # verifies every state transition + todo-tree mirror + graduation path.
    # Catches integration bugs in the chain decider before real agents hit them.
    try:
        import subprocess
        verifier = os.path.join(_project_root, "tools", "HME", "scripts", "verify-onboarding-flow.py")
        if os.path.isfile(verifier):
            rc = subprocess.run(
                ["python3", verifier],
                capture_output=True, text=True, timeout=30,
                env={**os.environ, "PROJECT_ROOT": _project_root},
            )
            if rc.returncode == 0:
                results.append("PASS: onboarding flow dry-run -- all transitions fire correctly")
            else:
                fail_line = next(
                    (ln for ln in rc.stdout.splitlines() if "failure" in ln.lower()),
                    "onboarding flow verifier returned nonzero",
                )
                results.append(f"FAIL: onboarding flow dry-run -- {fail_line}")
        else:
            results.append("INFO: onboarding flow dry-run -- verifier script not found")
    except Exception as e:
        results.append(f"WARN: onboarding flow dry-run -- {e}")

    # STATES sync verifier — catches Python-shell state list drift.
    try:
        import subprocess
        verifier = os.path.join(_project_root, "tools", "HME", "scripts", "verify-states-sync.py")
        if os.path.isfile(verifier):
            rc = subprocess.run(
                ["python3", verifier],
                capture_output=True, text=True, timeout=5,
                env={**os.environ, "PROJECT_ROOT": _project_root},
            )
            if rc.returncode == 0:
                results.append("PASS: STATES sync -- Python and shell arrays match")
            elif rc.returncode == 1:
                results.append(f"FAIL: STATES sync -- drift between onboarding_chain.py and _onboarding.sh (run verify-states-sync.py for diff)")
            else:
                results.append(f"WARN: STATES sync -- verifier parse error")
        else:
            results.append("INFO: STATES sync -- verifier script not found")
    except Exception as e:
        results.append(f"WARN: STATES sync -- {e}")

    # Unified HME Coherence Index — runs ALL 15 verifiers (subsumes the three
    # individual verifiers above into a single weighted score 0-100). This is
    # the subquantum-depth dimension that treats HME's own coherence the way
    # Polychron treats musical coherence: as a continuous signal, not a binary
    # pass/fail. Wired in addition to the individual verifiers so failures
    # surface granularly AND as an aggregate.
    try:
        import subprocess
        verifier = os.path.join(_project_root, "tools", "HME", "scripts", "verify-coherence.py")
        if os.path.isfile(verifier):
            rc = subprocess.run(
                ["python3", verifier, "--score"],
                capture_output=True, text=True, timeout=60,
                env={**os.environ, "PROJECT_ROOT": _project_root},
            )
            try:
                hci = int(rc.stdout.strip())
            except (ValueError, AttributeError):
                hci = -1
            if hci >= 95:
                results.append(f"PASS: HCI -- {hci}/100 (HME coherence index)")
            elif hci >= 80:
                results.append(f"WARN: HCI -- {hci}/100 (run verify-coherence.py for breakdown)")
            elif hci >= 0:
                results.append(f"FAIL: HCI -- {hci}/100 (significant coherence drift; run verify-coherence.py)")
            else:
                results.append(f"WARN: HCI -- could not parse score from verifier")
        else:
            results.append("INFO: HCI -- verifier script not found")
    except Exception as e:
        results.append(f"WARN: HCI -- {e}")

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
        results.append(f"{'PASS' if test else 'FAIL'}: local inference (llamacpp) -- {'connected' if test else 'no response'}")
    except Exception as e:
        results.append(f"FAIL: local inference -- {e}")

    try:
        from .synthesis import warm_context_status
        from . import synthesis_llamacpp as _so
        _so._refresh_arbiter()
        _ARBITER_MODEL = _so._ARBITER_MODEL
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
    except Exception as _err:
        logger.debug(f"unnamed-except evolution_selftest.py:319: {type(_err).__name__}: {_err}")
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
        from . import synthesis_llamacpp as _so
        if _so._last_think_failure == "timeout":
            import time as _ts_time
            _cooldown_remaining = max(0, _so._TIMEOUT_COOLDOWN_S - (_ts_time.monotonic() - _so._last_think_failure_ts))
            results.append(f"FAIL: llama.cpp cooldown -- timeout {int(_cooldown_remaining)}s remaining, synthesis calls blocked")
        elif _so._last_think_failure == "error":
            results.append(f"WARN: llama.cpp last failure -- non-timeout error (will retry)")
    except Exception as _err2:
        logger.debug(f"results.append: {type(_err2).__name__}: {_err2}")

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
    except Exception as _err3:
        logger.debug(f"results.append: {type(_err3).__name__}: {_err3}")

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
