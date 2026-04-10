"""HME administration — selftest, hot-reload, introspection, antipattern enforcement."""
import os
import re
import logging

from server import context as ctx
from .synthesis import _local_think
from . import _get_compositional_context, _track, _usage_stats

logger = logging.getLogger("HME")


def hme_introspect() -> str:
    """Self-benchmarking: report tool usage patterns, workflow discipline, KB health."""
    _track("hme_introspect")
    parts = ["## HME Session Introspection\n"]

    if _usage_stats:
        sorted_usage = sorted(_usage_stats.items(), key=lambda x: -x[1])
        parts.append("### Tool Usage This Session")
        for tool, count in sorted_usage:
            parts.append(f"  {tool}: {count}")
        parts.append(f"\n**Total tracked calls:** {sum(c for _, c in sorted_usage)}")
        expected = {"learn", "find", "read", "review", "evolve", "status", "trace"}
        unused = expected - set(_usage_stats.keys())
        if unused:
            parts.append(f"**Mandatory but unused:** {', '.join(sorted(unused))}")

        be_count = _usage_stats.get("before_editing", 0)
        wf_count = _usage_stats.get("what_did_i_forget", 0)
        if be_count > 0 or wf_count > 0:
            parts.append(f"\n### Workflow Discipline")
            parts.append(f"  before_editing: {be_count}  |  what_did_i_forget: {wf_count}")
            if be_count > 0 and wf_count == 0:
                parts.append(f"  WARNING: editing without post-change audits")
            elif be_count > wf_count + 2:
                parts.append(f"  NOTE: {be_count - wf_count} edits lack matching post-audits")
            elif wf_count > 0 and be_count == 0:
                parts.append(f"  WARNING: post-audits without pre-edit research")
            else:
                parts.append(f"  Good: pre-edit/post-audit ratio balanced")
    else:
        parts.append("### Tool Usage: no tracked calls yet")

    parts.append("")

    comp = _get_compositional_context("system")
    if comp:
        parts.append("### Last Run Musical Context")
        parts.append(comp)

    journal_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "journal.md")
    if os.path.isfile(journal_path):
        try:
            with open(journal_path, encoding="utf-8") as _jf:
                journal_content = _jf.read()
            section_starts = [m.start() for m in re.finditer(r'^## R\d+', journal_content, re.MULTILINE)]
            if section_starts:
                start = section_starts[-1]
                rest = journal_content[start + 4:]
                next_match = re.search(r'^## ', rest, re.MULTILINE)
                end = (start + 4 + next_match.start()) if next_match else len(journal_content)
                latest_section = journal_content[start:end].rstrip()
                if len(latest_section) > 1500:
                    cut = latest_section.rfind('\n', 0, 1500)
                    latest_section = latest_section[:cut if cut > 0 else 1500] + "\n  ... (truncated)"
                parts.append("\n### Latest Journal Entry")
                parts.append(latest_section)
        except Exception:
            pass

    kb_count = 0
    kb_categories: dict = {}
    try:
        ctx.ensure_ready_sync()
        all_kb_full = ctx.project_engine.list_knowledge_full() if hasattr(ctx.project_engine, 'list_knowledge_full') else []
        kb_count = len(all_kb_full)
        for entry in all_kb_full:
            cat = entry.get("category", "unknown")
            kb_categories[cat] = kb_categories.get(cat, 0) + 1
    except Exception:
        try:
            all_kb = ctx.project_engine.list_knowledge()
            kb_count = len(all_kb)
        except Exception:
            pass
    idx = {"files": 0, "chunks": 0, "symbols": 0}
    try:
        status = ctx.project_engine.get_status()
        idx["files"] = status.get("total_files", 0)
        idx["chunks"] = status.get("total_chunks", 0)
        sym_status = ctx.project_engine.get_symbol_status()
        idx["symbols"] = sym_status.get("total_symbols", 0) if sym_status.get("indexed") else 0
    except Exception:
        pass
    parts.append(f"\n### System Health")
    parts.append(f"  KB entries: {kb_count}")
    if kb_categories:
        cat_str = ", ".join(f"{cat}:{n}" for cat, n in sorted(kb_categories.items(), key=lambda x: -x[1]))
        parts.append(f"  KB breakdown: {cat_str}")
    parts.append(f"  Index: {idx['files']} files, {idx['chunks']} chunks, {idx['symbols']} symbols")

    return "\n".join(parts)


def hme_hot_reload(modules: str = "") -> str:
    """Hot-reload HME tool modules without restarting the server."""
    import sys
    import importlib
    _track("hme_hot_reload")

    RELOADABLE = [
        "synthesis", "synthesis_config", "synthesis_ollama",
        "synthesis_session", "synthesis_warm", "synthesis_pipeline",
        "symbols", "workflow", "workflow_audit",
        "reasoning", "reasoning_think",
        "health",
        "evolution", "evolution_next", "evolution_suggest",
        "evolution_trace", "evolution_admin",
        "runtime", "composition", "trust_analysis",
        "digest", "digest_analysis",
        "section_compare", "perceptual", "perceptual_engines",
        "coupling", "coupling_data", "coupling_channels", "coupling_clusters", "coupling_bridges",
        "drama_map", "health_analysis", "section_labels",
        "evolution_evolve", "search_unified", "review_unified",
        "read_unified", "learn_unified", "status_unified", "trace_unified",
        "todo", "enrich_prompt",
    ]
    TOP_LEVEL_RELOADABLE = ["tools_search", "tools_knowledge"]
    # Root-level modules (not under server/): imported directly, no package prefix
    ROOT_RELOADABLE = ["file_walker", "lang_registry", "chunker"]
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
    results.append(f"{'PASS' if tool_count >= 11 else 'FAIL'}: {tool_count} tools registered")

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

    # Warm KV context + arbiter health
    try:
        from .synthesis import warm_context_status, _ARBITER_MODEL
        wcs = warm_context_status()
        for model_name, info in wcs.items():
            if model_name in ("arbiter", "think_history", "session_narrative"):
                continue
            if isinstance(info, dict) and info.get("primed"):
                _tokens = info.get("tokens", 0)
                _age = info.get("age_s", 0)
                # Fail-fast: warm ctx with 0 tokens or extremely old (>1hr) is suspect
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
        _reloadable_set = set(hme_hot_reload.__code__.co_consts or [])
        # Re-extract RELOADABLE from the function source since co_consts isn't reliable
        import inspect as _inspect
        _src = _inspect.getsource(hme_hot_reload)
        import re as _re_reload
        _in_list = set(_re_reload.findall(r'"(\w+)"', _src.split("RELOADABLE")[1].split("]")[0]))
        _missing = _all_modules - _in_list
        if _missing:
            results.append(f"FAIL: hot-reload coverage -- missing modules: {sorted(_missing)}")
        else:
            results.append(f"PASS: hot-reload coverage -- all {len(_all_modules)} modules in RELOADABLE")
    except Exception as e:
        results.append(f"WARN: hot-reload coverage -- check failed: {e}")

    # Timeout cooldown: surface _last_think_failure state
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

    # Log error surfacing: scan recent hme.log for unaddressed warnings/errors
    try:
        _log_path = os.path.join(ctx.PROJECT_ROOT, "log", "hme.log")
        if os.path.isfile(_log_path):
            import collections as _col
            _error_counts = _col.Counter()
            with open(_log_path, encoding="utf-8", errors="ignore") as _lf:
                # Read last 200 lines
                _lines = _lf.readlines()[-200:]
            for _line in _lines:
                if " WARNING " in _line or " ERROR " in _line:
                    # Extract the message part after the log level
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
    total = len(results)
    header = f"## HME Self-Test: {passed}/{total} passed\n"
    return header + "\n".join(f"  {r}" for r in results)


@ctx.mcp.tool()
def hme_admin(action: str = "selftest", modules: str = "") -> str:
    """HME maintenance dispatcher. action='selftest': verify tool registration, doc sync,
    index integrity, Ollama, KB health, symlinks. action='reload': hot-reload tool modules
    without restarting server (pass modules='health,evolution' or 'all'). action='index':
    reindex all code chunks and symbols (run after batch code changes when file watcher
    hasn't caught up). action='clear_index': wipe hash cache + chunk store then rebuild.
    action='warm': pre-populate before_editing caches for all src/ files AND prime GPU KV contexts.
    action='introspect': self-benchmarking — tool usage patterns, workflow discipline, KB health.
    action='both': reload then selftest.
    Use after structural changes to HME tool files."""
    _track("hme_admin")
    parts = []
    if action in ("reload", "both"):
        parts.append(hme_hot_reload(modules))
    if action in ("selftest", "both"):
        parts.append(hme_selftest())
    if action == "index":
        try:
            from tools_index import index_codebase as _index_codebase
            parts.append(_index_codebase())
        except Exception as e:
            parts.append(f"index_codebase error: {e}")
    if action == "clear_index":
        try:
            from tools_index import clear_index as _clear_index
            parts.append(_clear_index())
        except Exception as e:
            parts.append(f"clear_index error: {e}")
    if action == "warm":
        import threading as _threading
        # Fire pre-edit cache and GPU warm KV context priming as independent parallel tasks.
        # Pre-edit cache scans 630 files (slow). GPU priming sends Ollama requests (fast start).
        # Running them separately means GPU priming logs appear immediately.
        def _bg_gpu_warm():
            logger.info("warm: GPU KV context priming starting (3 models)")
            try:
                from .synthesis import _prime_all_gpus
                _prime_all_gpus()
                logger.info("warm: GPU KV context priming complete")
            except Exception as e:
                logger.info(f"warm: GPU KV context error: {e}")
        def _bg_pre_edit():
            logger.info("warm: pre-edit cache priming starting (all src/ files)")
            try:
                from .workflow import warm_pre_edit_cache as _warm_cache
                _warm_cache()
                logger.info("warm: pre-edit cache priming complete")
            except Exception as e:
                logger.info(f"warm: pre-edit cache error: {e}")
        _threading.Thread(target=_bg_gpu_warm, daemon=True).start()
        _threading.Thread(target=_bg_pre_edit, daemon=True).start()
        parts.append(
            "Warm priming started (2 parallel background tasks: GPU KV contexts + pre-edit cache).\n"
            "Use hme_admin(action='selftest') to check status."
        )
    if action == "introspect":
        parts.append(hme_introspect())
    if not parts:
        return f"Unknown action '{action}'. Use 'selftest', 'reload', 'index', 'clear_index', 'warm', 'introspect', or 'both'."
    return "\n\n".join(parts)


def hme_inspect(mode: str = "both") -> str:
    """Merged HME self-inspection."""
    _track("hme_inspect")
    parts = []
    if mode in ("introspect", "both"):
        parts.append(hme_introspect())
    if mode in ("selftest", "both"):
        parts.append(hme_selftest())
    if not parts:
        return f"Unknown mode '{mode}'. Use 'introspect', 'selftest', or 'both'."
    return "\n\n".join(parts)


@ctx.mcp.tool()
def fix_antipattern(antipattern: str, hook_target: str = "pretooluse_bash") -> str:
    """Permanently enforce a rule against a stubborn antipattern by adding detection logic
    to the specified hook script."""
    _track("fix_antipattern")
    if not antipattern or not antipattern.strip():
        return "Error: antipattern cannot be empty."
    valid_hooks = {
        "pretooluse_bash", "pretooluse_read", "pretooluse_edit", "pretooluse_grep",
        "pretooluse_write", "posttooluse_bash", "stop", "userpromptsubmit",
    }
    if hook_target not in valid_hooks:
        return f"Error: hook_target must be one of: {', '.join(sorted(valid_hooks))}"

    # Warn when hook choice is likely wrong for the antipattern type
    _ap_lower = antipattern.lower()
    _code_content_signals = ("console.log", "console.warn", "catch {}", ".catch(", "throw", "import", "require",
                              "in src/", "in source", "in code", "pattern in file", "code smell")
    _bash_cmd_signals = ("npm run", "git ", "bash ", "shell command", "script")
    if hook_target == "pretooluse_bash" and any(s in _ap_lower for s in _code_content_signals):
        return (
            f"WRONG HOOK: '{antipattern}' is a code-content antipattern (file contents), not a bash-command antipattern.\n"
            f"Use hook_target='pretooluse_edit' (catches Edit new_string) or 'pretooluse_write' (catches Write content).\n"
            f"pretooluse_bash only sees shell commands — it cannot reliably detect patterns inside source files."
        )
    if hook_target in ("pretooluse_edit", "pretooluse_write") and any(s in _ap_lower for s in _bash_cmd_signals):
        return (
            f"WRONG HOOK: '{antipattern}' is a bash-command antipattern.\n"
            f"Use hook_target='pretooluse_bash' which sees the command string before execution."
        )

    hooks_dir = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "hooks")
    hook_path = os.path.join(hooks_dir, f"{hook_target}.sh")
    if not os.path.isfile(hook_path):
        return f"Hook file not found: {hook_path}"
    with open(hook_path, encoding="utf-8") as _f:
        current = _f.read()

    hook_context = {
        "pretooluse_bash": (
            "This hook fires ONCE PER TOOL CALL before a Bash command executes. "
            "Available variables: CMD (the bash command string), INPUT (raw JSON). "
            "Use CMD-based matching. To block: exit 2 with JSON. "
        ),
        "posttooluse_bash": (
            "This hook fires ONCE PER TOOL CALL after a Bash command completes. "
            "Available variables: CMD (the bash command), INPUT (raw JSON including output). "
        ),
        "stop": (
            "This hook fires ONCE when Claude is about to stop responding. "
            "Available variables: INPUT (JSON with transcript_path). "
            "This is the ONLY hook that can detect BEHAVIORAL PATTERNS across multiple tool calls."
        ),
        "userpromptsubmit": (
            "This hook fires when the user submits a prompt. "
            "Available variables: INPUT (JSON with the user prompt text)."
        ),
        "pretooluse_edit": (
            "This hook fires before an Edit tool call. "
            "Available variables: INPUT (JSON with file_path, old_string, new_string)."
        ),
        "pretooluse_grep": (
            "This hook fires before a Grep tool call. "
            "Available variables: INPUT (raw JSON)."
        ),
        "pretooluse_write": (
            "This hook fires before a Write tool call. "
            "Available variables: INPUT (JSON with file_path, content)."
        ),
    }
    hook_guidance = hook_context.get(hook_target, "")

    synthesis_prompt = (
        f"You are writing a bash snippet to add to a Claude Code hook script.\n"
        f"Hook: {hook_target}.sh\n"
        f"Hook context: {hook_guidance}\n\n"
        f"Current hook content:\n{current}\n\n"
        f"Antipattern to prevent: {antipattern}\n\n"
        f"Write ONLY the bash snippet (no markdown fences). 5-15 lines maximum."
    )
    snippet = _local_think(synthesis_prompt, max_tokens=256)
    if not snippet:
        return (
            f"Could not synthesize snippet.\n"
            f"Manually add detection logic to: {hook_path}\n"
            f"Antipattern to prevent: {antipattern}"
        )

    snippet = re.sub(r'^```[a-z]*\n?', '', snippet.strip())
    snippet = re.sub(r'\n?```$', '', snippet)

    stripped = current.rstrip("\n")
    insertion = f"\n\n# fix_antipattern: {antipattern[:80]}\n{snippet.strip()}\n"
    if stripped.endswith("exit 0"):
        lines = stripped.split("\n")
        for i in range(len(lines) - 1, -1, -1):
            if lines[i].strip() == "exit 0":
                lines.insert(i, insertion.strip())
                new_content = "\n".join(lines) + "\n"
                break
        else:
            new_content = stripped + insertion
    else:
        new_content = stripped + insertion
    with open(hook_path, "w", encoding="utf-8") as _f:
        _f.write(new_content)

    return (
        f"# fix_antipattern: Applied enforcement to {hook_target}.sh\n\n"
        f"**Antipattern:** {antipattern}\n\n"
        f"**Appended snippet:**\n```bash\n{snippet.strip()}\n```\n\n"
        f"Hook file: {hook_path}"
    )
