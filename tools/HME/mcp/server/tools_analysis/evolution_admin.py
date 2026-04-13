"""HME administration — selftest, hot-reload, introspection, antipattern enforcement."""
import os
import re
import logging
import subprocess

from server import context as ctx
from .synthesis import _local_think
from . import _track
from .evolution_introspect import hme_introspect  # noqa: F401
from .evolution_selftest import hme_selftest, hme_hot_reload  # noqa: F401

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def hme_admin(action: str = "selftest", modules: str = "",
              antipattern: str = "", hook_target: str = "pretooluse_bash") -> str:
    """HME maintenance dispatcher. action='selftest': verify tool registration, doc sync,
    index integrity, Ollama, KB health, symlinks. action='reload': hot-reload tool modules
    without restarting server (pass modules='health,evolution' or 'all'). action='index':
    reindex all code chunks and symbols (run after batch code changes when file watcher
    hasn't caught up). action='clear_index': wipe hash cache + chunk store then rebuild.
    action='warm': pre-populate before_editing caches for all src/ files AND prime GPU KV contexts.
    action='introspect': self-benchmarking — tool usage patterns, workflow discipline, KB health.
    action='validate': empirical self-validation — runs golden queries through MCP tools
    and checks output quality (expected sections, no errors, minimum length).
    action='fix_antipattern': synthesize bash detection logic for a behavioral rule and append
    to a hook script (antipattern=, hook_target= one of: pretooluse_bash/edit/read/grep/write,
    posttooluse_bash, stop, userpromptsubmit).
    action='both': reload then selftest.
    Use after structural changes to HME tool files."""
    _track("hme_admin")
    from .synthesis_session import append_session_narrative
    append_session_narrative("admin", f"hme_admin({action}): {modules or 'default'}")
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
    if action == "validate":
        parts.append(_hme_validate_golden())
    if not parts:
        return f"Unknown action '{action}'. Use 'selftest', 'reload', 'index', 'clear_index', 'warm', 'introspect', 'validate', or 'both'."
    return "\n\n".join(parts)


def _hme_validate_golden() -> str:
    """Empirical self-validation: run golden queries through MCP tools and check output quality."""

    def _call(tool_fn, **kwargs):
        try:
            return tool_fn(**kwargs)
        except Exception as e:
            return f"Error: {type(e).__name__}: {e}"

    from .read_unified import read as _read
    from .evolution_evolve import evolve as _evolve
    from .status_unified import status as _status
    from .trace_unified import trace as _trace

    golden = [
        {
            "name": "read(before) src module",
            "call": lambda: _call(_read, target="harmonicIntervalGuard", mode="before"),
            "expect": ["KB Constraints", "Structure"],
            "reject": ["Error:", "Traceback"],
            "min_lines": 10,
        },
        {
            "name": "read(before) HME module",
            "call": lambda: _call(_read, target="coupling_bridges", mode="before"),
            "expect": ["HME Internal Context", "RELOADABLE"],
            "reject": ["Error:", "Traceback"],
            "min_lines": 8,
        },
        {
            "name": "evolve(coupling)",
            "call": lambda: _call(_evolve, focus="coupling"),
            "expect": ["Coupling"],
            "reject": ["Traceback"],
            "min_lines": 3,
        },
        {
            "name": "status(hme) selftest",
            "call": lambda: _call(_status, mode="hme"),
            "expect": ["Self-Test", "tools registered"],
            "reject": ["FAIL"],
            "min_lines": 5,
        },
        {
            "name": "trace(delta)",
            "call": lambda: _call(_trace, target="auto", mode="delta"),
            "expect": ["Delta"],
            "reject": ["Traceback"],
            "min_lines": 2,
        },
        {
            "name": "evolve(curate)",
            "call": lambda: _call(_evolve, focus="curate"),
            "expect": ["Curate"],
            "reject": ["Traceback"],
            "min_lines": 2,
        },
    ]

    passed, failed = 0, 0
    results = []

    for gq in golden:
        try:
            output = gq["call"]()
            if not output:
                results.append(f"  FAIL: {gq['name']} -- empty output")
                failed += 1
                continue

            lines = output.split("\n")
            issues = []

            if len(lines) < gq.get("min_lines", 1):
                issues.append(f"short ({len(lines)}<{gq['min_lines']})")

            for kw in gq.get("expect", []):
                if kw not in output:
                    issues.append(f"missing '{kw}'")

            for kw in gq.get("reject", []):
                if kw in output:
                    issues.append(f"has '{kw}'")

            if issues:
                results.append(f"  FAIL: {gq['name']} -- {'; '.join(issues)}")
                failed += 1
            else:
                results.append(f"  PASS: {gq['name']} ({len(lines)} lines)")
                passed += 1
        except Exception as e:
            results.append(f"  ERROR: {gq['name']} -- {type(e).__name__}: {e}")
            failed += 1

    verdict = "ALL PASS" if failed == 0 else f"{failed} FAILED"
    return f"## Golden Query Validation: {verdict}\n  {passed}/{passed + failed} passed\n" + "\n".join(results)


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
    snippet = _local_think(synthesis_prompt, max_tokens=512)
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

    # Validate bash syntax before writing — reject truncated/broken snippets
    check = subprocess.run(
        ["bash", "-n"],
        input=new_content, capture_output=True, text=True, timeout=5,
    )
    if check.returncode != 0:
        return (
            f"REJECTED: Generated snippet has bash syntax errors — refusing to write broken code.\n"
            f"bash -n stderr: {check.stderr.strip()}\n\n"
            f"**Snippet that failed:**\n```bash\n{snippet.strip()}\n```\n\n"
            f"Fix manually or retry. Hook file NOT modified: {hook_path}"
        )

    with open(hook_path, "w", encoding="utf-8") as _f:
        _f.write(new_content)

    return (
        f"# fix_antipattern: Applied enforcement to {hook_target}.sh\n\n"
        f"**Antipattern:** {antipattern}\n\n"
        f"**Appended snippet:**\n```bash\n{snippet.strip()}\n```\n\n"
        f"Hook file: {hook_path}"
    )
