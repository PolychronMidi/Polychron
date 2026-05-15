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

logger = logging.getLogger("HME")


@ctx.mcp.tool(meta={"hidden": True})
@chained("hme_admin")
def hme_admin(action: str = "selftest", modules: str = "",
              antipattern: str = "", hook_target: str = "pretooluse_bash") -> str:
    """HME maintenance dispatcher. action='selftest': verify tool registration, doc sync,
    index integrity, llama.cpp, KB health, symlinks. action='reload': hot-reload tool modules
    without restarting server (pass modules='health,evolution' or 'all'). action='index':
    reindex all code chunks and symbols (run after batch code changes when file watcher
    hasn't caught up). action='clear_index': wipe hash cache + chunk store then rebuild.
    action='warm': pre-populate before_editing caches for all src/ files AND prime GPU KV contexts.
    action='introspect': self-benchmarking -- tool usage patterns, workflow discipline, KB health.
    action='validate': empirical self-validation -- runs golden queries through MCP tools
    and checks output quality (expected sections, no errors, minimum length).
    action='fix_antipattern': synthesize bash detection logic for a behavioral rule and append
    to a hook script (antipattern=, hook_target= one of: pretooluse_bash/edit/read/grep/write,
    posttooluse_bash, stop, userpromptsubmit).
    action='both': reload then selftest.
    Use after structural changes to HME tool files."""
    _track("hme_admin")
    from ..synthesis_session import append_session_narrative
    append_session_narrative("admin", f"hme_admin({action}): {modules or 'default'}")
    # Normalize common aliases. `restart` is the instinct-reach, but hot-reload
    if action == "restart":
        action = "reload"

    parts = []
    if action in ("reload", "both"):
        parts.append(hme_hot_reload(modules))
    if action in ("selftest", "both"):
        # `modules` is overloaded as the verbose-flag carrier for selftest
        parts.append(hme_selftest(verbose=("verbose" in (modules or "").lower())))
    if action == "index":
        try:
            from tools_index import index_codebase as _index_codebase
            parts.append(_index_codebase())
        except Exception as e:
            # silent-ok: optional fallback path.
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
                from ..synthesis import _prime_all_gpus
                _prime_all_gpus()
                logger.info("warm: GPU KV context priming complete")
            except Exception as e:
                logger.info(f"warm: GPU KV context error: {e}")
        def _bg_pre_edit():
            logger.info("warm: pre-edit cache priming starting (all src/ files)")
            try:
                from ..workflow import _warm_pre_edit_cache_sync as _warm_cache
                _warm_cache()
                logger.info("warm: pre-edit cache priming complete")
            except Exception as e:
                logger.info(f"warm: pre-edit cache error: {e}")
        _threading.Thread(target=_bg_gpu_warm, daemon=True).start()
        _threading.Thread(target=_bg_pre_edit, daemon=True).start()
        try:
            from tool_invocations import action_form as _action_form
        except ImportError:
            def _action_form(a): return f"i/hme admin action={a}"
        parts.append(
            "Warm priming started (2 parallel background tasks: GPU KV contexts + pre-edit cache).\n"
            f"Use `{_action_form('selftest')}` to check status."
        )
    if action == "introspect":
        parts.append(hme_introspect())
    if action == "validate":
        parts.append(_hme_validate_golden())
    if action == "fix_antipattern":
        parts.append(fix_antipattern(antipattern, hook_target))
    if action == "health":
        try:
            from server.health_summary import health as _health
            parts.append(_health())
        except Exception as e:
            parts.append(f"health summary error: {type(e).__name__}: {e}")
    if not parts:
        return f"Unknown action '{action}'. Use 'selftest', 'reload', 'index', 'clear_index', 'warm', 'introspect', 'validate', 'fix_antipattern', 'health', or 'both'."
    return "\n\n".join(parts)


def _hme_validate_golden() -> str:
    """Empirical self-validation: run golden queries through MCP tools and check output quality."""

    def _call(tool_fn, **kwargs):
        try:
            return tool_fn(**kwargs)
        except Exception as e:
            return f"Error: {type(e).__name__}: {e}"

    from ..read_unified import read as _read
    from .evolution_evolve import evolve as _evolve
    from ..status_unified import status as _status
    from ..trace_unified import trace as _trace

    golden = [
        {
            "name": "pre-edit briefing src module",
            "call": lambda: _call(_read, target="harmonicIntervalGuard", mode="before"),
            "expect": ["KB Constraints", "Structure"],
            "reject": ["Error:", "Traceback"],
            "min_lines": 10,
        },
        {
            "name": "pre-edit briefing HME module",
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


def _daemon_health_snapshot() -> dict:
    """Return {ready_aliases: [...], statuses: {name: 'healthy'|'loading'|'unreachable'}}.

    Queries the llamacpp daemon's /health and translates instance-level
    data (last_health_ok age, pid) into the same three-state taxonomy used
    by startup_validator. Returns an empty snapshot if the daemon itself
    is unreachable -- callers treat that as "nothing ready."
    """
    import json as _json
    import time as _time
    import urllib.request as _ur
    from hme_env import ENV
    try:
        daemon_url = ENV.require("HME_LLAMACPP_DAEMON_URL")
        with _ur.urlopen(f"{daemon_url}/health", timeout=3) as resp:
            data = _json.loads(resp.read())
    except Exception as _err:
        logger.debug(f"_daemon_health_snapshot: daemon unreachable: {_err}")
        return {"ready_aliases": [], "statuses": {"daemon": f"unreachable ({type(_err).__name__})"}}
    ready_aliases: list[str] = []
    statuses: dict[str, str] = {}
    now = _time.time()
    for inst in data.get("instances", []):
        name = inst.get("name", "?")
        alias = inst.get("alias", "")
        last_ok = inst.get("last_health_ok", 0) or 0
        age = now - last_ok if last_ok else float("inf")
        pid = inst.get("pid")
        if age < 120 and pid:
            statuses[name] = f"healthy (alias={alias})"
            if alias:
                ready_aliases.append(alias)
        elif pid:
            statuses[name] = f"loading (alias={alias}, last_ok_age={age:.0f}s)"
        else:
            statuses[name] = f"unreachable (alias={alias})"
    return {"ready_aliases": ready_aliases, "statuses": statuses}



# Re-export -- fix_antipattern extracted.
from .evolution_fix_antipattern import fix_antipattern  # noqa: F401, E402
