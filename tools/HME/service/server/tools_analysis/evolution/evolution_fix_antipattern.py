"""HME administration -- selftest, hot-reload, introspection, antipattern enforcement."""
import os
import re
import logging
import subprocess

from server import context as ctx
from server.onboarding_chain import chained
from ..synthesis import _local_think
from ..synthesis.synthesis_llamacpp import _LOCAL_MODEL, _ARBITER_MODEL
from ..synthesis import synthesis_reasoning
from .. import _track
from .evolution_introspect import hme_introspect  # noqa: F401
from .evolution_selftest import hme_selftest, hme_hot_reload  # noqa: F401
from .evolution_admin import _daemon_health_snapshot  # noqa: F401

logger = logging.getLogger("HME")


# meta hidden=True: this is dispatched through hme_admin(action='fix_antipattern')
# (see evolution_admin.py:99-100). Exposing it as a separate public tool
# duplicates the surface and breaks the "one public tool per dispatcher"
# convention -- tool-surface-coverage flagged it as undocumented because
# ONBOARDING/HME.md correctly only document the parent.
@ctx.mcp.tool(meta={"hidden": True})
@chained("hme_admin")


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
            f"pretooluse_bash only sees shell commands -- it cannot reliably detect patterns inside source files."
        )
    if hook_target in ("pretooluse_edit", "pretooluse_write") and any(s in _ap_lower for s in _bash_cmd_signals):
        return (
            f"WRONG HOOK: '{antipattern}' is a bash-command antipattern.\n"
            f"Use hook_target='pretooluse_bash' which sees the command string before execution."
        )

    hooks_dir = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "hooks")
    # Hook files are organized into subdirectories by lifecycle phase after
    # the hooks/ reorg. Search the likely locations instead of hardcoding flat.
    _sub_dirs_by_hook = {
        "stop": "lifecycle", "sessionstart": "lifecycle", "userpromptsubmit": "lifecycle",
        "postcompact": "lifecycle", "precompact": "lifecycle",
        "pretooluse_bash": "pretooluse", "pretooluse_edit": "pretooluse",
        "pretooluse_read": "pretooluse", "pretooluse_grep": "pretooluse",
        "pretooluse_write": "pretooluse",
        "pretooluse_hme_primer": "pretooluse",
        "pretooluse_check_pipeline": "pretooluse",
        "posttooluse_bash": "posttooluse", "posttooluse_edit": "posttooluse",
        "posttooluse_read_kb": "posttooluse", "posttooluse_write": "posttooluse",
        "posttooluse_addknowledge": "posttooluse",
        "posttooluse_hme_review": "posttooluse",
        "posttooluse_pipeline_kb": "posttooluse",
    }
    _sub = _sub_dirs_by_hook.get(hook_target, "")
    hook_path = os.path.join(hooks_dir, _sub, f"{hook_target}.sh") if _sub else os.path.join(hooks_dir, f"{hook_target}.sh")
    if not os.path.isfile(hook_path):
        # Fallback: search all subdirs before giving up.
        for _cand_sub in ("", "lifecycle", "pretooluse", "posttooluse", "helpers"):
            _cand = os.path.join(hooks_dir, _cand_sub, f"{hook_target}.sh") if _cand_sub else os.path.join(hooks_dir, f"{hook_target}.sh")
            if os.path.isfile(_cand):
                hook_path = _cand
                break
        else:
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
    # Preflight: survey all synthesis backends so an actionable diagnostic
    # names what's actually down. Two substrates:
    #   (1) local llama-server instances (coder on GPU1, arbiter on GPU0)
    #   (2) the ranked API cascade (synthesis_reasoning) -- gemini/groq/etc.
    # "Reasoning" is NOT a local model -- it lives entirely on the API side.
    _health = _daemon_health_snapshot()
    _ready_local = _health.get("ready_aliases", [])
    try:
        _api_reasoning_up = synthesis_reasoning.available(profile="reasoning")
    except Exception as _api_err:
        logger.debug(f"fix_antipattern preflight: reasoning cascade probe failed: {_api_err}")
        _api_reasoning_up = False
    if not _ready_local and not _api_reasoning_up:
        _statuses = _health.get("statuses", {})
        _status_lines = "\n  ".join(
            f"local/{name}: {s}" for name, s in sorted(_statuses.items())
        ) or "local: (daemon unreachable)"
        return (
            f"fix_antipattern preflight failed -- no synthesis backend ready.\n"
            f"{_status_lines}\n"
            f"api/reasoning cascade: not reachable\n\n"
            f"Options: wait for local models to load (60-90s for cold MoE), "
            f"check llamacpp_daemon logs, or verify API keys for the ranked "
            f"reasoning cascade (gemini/groq/etc. -- see synthesis_reasoning).\n"
            f"Manually add detection logic to: {hook_path}\n"
            f"Antipattern to prevent: {antipattern}"
        )

    # Fallback chain: try local coder first (fast on a warm GPU), then the
    # ranked API reasoning cascade (better quality, free tier), then arbiter
    # as last resort (always-on but weaker for synthesis). Each call is
    # bounded by a 60s wall-clock timeout -- without it, an unreachable
    # llama-server makes the whole chain hang for 32s * 3 attempts (~96s)
    # per call, which is the "hangs at 20s" rating bug.
    import concurrent.futures as _cf
    def _bounded(fn, *args, **kwargs):
        _ex = _cf.ThreadPoolExecutor(max_workers=1)
        try:
            _fut = _ex.submit(fn, *args, **kwargs)
            try:
                return _fut.result(timeout=60)
            except _cf.TimeoutError:
                return None
        finally:
            _ex.shutdown(wait=False, cancel_futures=True)

    _tried: list[str] = []
    snippet = None
    if _LOCAL_MODEL in _ready_local:
        _tried.append(f"local/{_LOCAL_MODEL}")
        snippet = _bounded(_local_think, synthesis_prompt, max_tokens=512, model=_LOCAL_MODEL)
    if not snippet and _api_reasoning_up:
        _tried.append("api/reasoning-cascade")
        try:
            snippet = _bounded(
                synthesis_reasoning.call,
                prompt=synthesis_prompt, max_tokens=512,
                temperature=0.3, profile="reasoning",
            )
        except Exception as _api_err2:
            logger.debug(f"fix_antipattern: api reasoning cascade failed: {_api_err2}")
    if not snippet and _ARBITER_MODEL in _ready_local and _ARBITER_MODEL != _LOCAL_MODEL:
        _tried.append(f"local/{_ARBITER_MODEL}")
        snippet = _bounded(_local_think, synthesis_prompt, max_tokens=512, model=_ARBITER_MODEL)
    if not snippet:
        return (
            f"Could not synthesize snippet -- tried: {', '.join(_tried) or 'nothing'}. "
            f"All returned empty.\n"
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

    # Validate bash syntax before writing -- reject truncated/broken snippets
    check = subprocess.run(
        ["bash", "-n"],
        input=new_content, capture_output=True, text=True, timeout=5,
    )
    if check.returncode != 0:
        return (
            f"REJECTED: Generated snippet has bash syntax errors -- refusing to write broken code.\n"
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
