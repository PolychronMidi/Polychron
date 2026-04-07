"""HME administration — selftest, hot-reload, introspection, antipattern enforcement."""
import os
import re
import logging

from server import context as ctx
from .synthesis import _get_api_key, _claude_think, _local_think
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
        expected = {"before_editing", "what_did_i_forget", "search_knowledge", "search_code", "add_knowledge"}
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
        "synthesis", "symbols", "workflow", "reasoning", "health",
        "evolution", "evolution_next", "evolution_trace", "evolution_admin",
        "runtime", "composition", "trust_analysis",
        "digest", "section_compare", "perceptual",
        "coupling", "coupling_data", "coupling_channels", "coupling_clusters", "coupling_bridges",
    ]
    TOP_LEVEL_RELOADABLE = ["tools_search"]
    if not modules or modules.strip().lower() == "all":
        targets = RELOADABLE + TOP_LEVEL_RELOADABLE
    else:
        targets = [m.strip() for m in modules.split(",") if m.strip()]

    inner = ctx.mcp._inner
    old_warn = inner._tool_manager.warn_on_duplicate_tools
    inner._tool_manager.warn_on_duplicate_tools = False

    results = []
    try:
        for name in targets:
            if name in TOP_LEVEL_RELOADABLE:
                full = f"server.{name}"
            else:
                full = f"server.tools_analysis.{name}"
            mod = sys.modules.get(full)
            if mod is None:
                try:
                    if name in TOP_LEVEL_RELOADABLE:
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
    results.append(f"{'PASS' if tool_count > 20 else 'FAIL'}: {tool_count} tools registered")

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
        results.append(f"{'PASS' if consistent else 'WARN'}: hash cache -- {hash_count} hashes vs {table_files} indexed files")
    except Exception as e:
        results.append(f"FAIL: hash cache -- {e}")

    try:
        test = _local_think("respond with OK", max_tokens=5)
        results.append(f"{'PASS' if test else 'FAIL'}: Ollama -- {'connected' if test else 'no response'}")
    except Exception as e:
        results.append(f"FAIL: Ollama -- {e}")

    try:
        kb = ctx.project_engine.list_knowledge()
        results.append(f"{'PASS' if len(kb) > 0 else 'WARN'}: KB -- {len(kb)} entries")
    except Exception as e:
        results.append(f"FAIL: KB -- {e}")

    for name, target in [
        ("~/.claude/mcp/HME", "mcp symlink"),
        ("~/.claude/skills/HME", "skills symlink"),
    ]:
        path = os.path.expanduser(name)
        results.append(f"{'PASS' if os.path.islink(path) else 'FAIL'}: {target} -- {path}")

    passed = sum(1 for r in results if r.startswith("PASS"))
    total = len(results)
    header = f"## HME Self-Test: {passed}/{total} passed\n"
    output = header + "\n".join(f"  {r}" for r in results)

    try:
        introspect_out = hme_introspect()
        output += "\n\n" + introspect_out
    except Exception:
        pass

    return output


@ctx.mcp.tool()
def hme_admin(action: str = "selftest", modules: str = "") -> str:
    """HME maintenance dispatcher. action='selftest': verify tool registration, doc sync,
    index integrity, Ollama, KB health, symlinks. action='reload': hot-reload tool modules
    without restarting server (pass modules='health,evolution' or 'all'). action='index':
    reindex all code chunks and symbols (replaces standalone index_codebase -- run after batch
    code changes when file watcher hasn't caught up). action='clear_index': wipe hash cache +
    chunk store then rebuild from scratch (use when hash cache is stale or index is corrupted).
    action='warm': pre-populate before_editing caller+KB caches for all src/ files -- makes
    all subsequent before_editing calls instant. action='both': reload then selftest.
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
        try:
            from .workflow import warm_pre_edit_cache as _warm
            parts.append(_warm())
        except Exception as e:
            parts.append(f"warm_pre_edit_cache error: {e}")
    if not parts:
        return f"Unknown action '{action}'. Use 'selftest', 'reload', 'index', 'clear_index', 'warm', or 'both'."
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


def fix_antipattern(antipattern: str, hook_target: str = "pretooluse_bash") -> str:
    """Permanently enforce a rule against a stubborn antipattern by adding detection logic
    to the specified hook script."""
    _track("fix_antipattern")
    if not antipattern or not antipattern.strip():
        return "Error: antipattern cannot be empty."
    valid_hooks = {
        "pretooluse_bash", "posttooluse_bash", "stop",
        "userpromptsubmit", "pretooluse_edit", "pretooluse_grep", "pretooluse_write",
    }
    if hook_target not in valid_hooks:
        return f"Error: hook_target must be one of: {', '.join(sorted(valid_hooks))}"
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
    api_key = _get_api_key()
    snippet = None
    if api_key:
        snippet = _claude_think(synthesis_prompt, api_key, max_tool_calls=0)
    if not snippet:
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
