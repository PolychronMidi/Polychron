"""HME startup self-test — fail-fast validation after engines are initialized.

Runs once after _background_load() completes. Any failure here aborts startup by
raising into _startup_error, ensuring tools crash loudly rather than silently
returning degraded output.

Philosophy: mirrors src/ fail-fast (loud crashes, never silent corruption).
"""
import os
import sys
import logging

_mcp_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402

logger = logging.getLogger("HME")


def validate_startup(context, project_root: str) -> None:
    """Validate all required state is present and functional. Raises RuntimeError on any failure.

    Called from _background_load() after all engines are assigned to context.
    Errors propagate to context._startup_error and re-raise on first tool call via ensure_ready_sync().
    """
    _check_engines(context)
    _check_kb_accessible(context)
    _check_project_root(project_root)
    _check_required_metrics_dirs(project_root)
    _check_registry_api_surface()  # catches stale FastMCP refs at boot, not call time
    _check_llamacpp_connectivity()  # warning only — llama.cpp may start later
    logger.info("HME startup validation PASSED")


def _check_engines(context) -> None:
    """All three required engines must be initialized and functional."""
    if context.project_engine is None:
        raise RuntimeError("project_engine is None — RAGEngine failed to initialize")
    if context.global_engine is None:
        raise RuntimeError("global_engine is None — RAGEngine failed to initialize")
    if context.shared_model is None:
        raise RuntimeError("shared_model is None — SentenceTransformer failed to load")

    # Smoke-test: ensure the embedding model actually works. With the shim
    # gone, engines are always in-process — no proxy-mode branch to skip.
    try:
        result = context.shared_model.encode(["test"], show_progress_bar=False)
        if result is None or len(result) == 0:
            raise RuntimeError("shared_model.encode returned empty result")
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"shared_model smoke-test failed: {e}") from e


def _check_kb_accessible(context) -> None:
    """KB must be queryable — catches DB corruption or engine initialization failure."""
    try:
        # list_knowledge is lightweight — just reads index, no embedding needed
        result = context.project_engine.list_knowledge()
        # result can be empty list (new project) — that's fine
        if not isinstance(result, list):
            raise RuntimeError(f"project_engine.list_knowledge() returned {type(result).__name__}, expected list")
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"project_engine.list_knowledge() failed: {e}") from e


def _check_project_root(project_root: str) -> None:
    """PROJECT_ROOT must exist and contain expected Polychron directories."""
    if not project_root:
        raise RuntimeError("PROJECT_ROOT is empty — set PROJECT_ROOT env var")
    if not os.path.isdir(project_root):
        raise RuntimeError(f"PROJECT_ROOT does not exist: {project_root}")
    # Must have src/ (core codebase) — indicates this is actually a Polychron project
    src_dir = os.path.join(project_root, "src")
    if not os.path.isdir(src_dir):
        raise RuntimeError(
            f"PROJECT_ROOT has no src/ directory: {project_root}\n"
            "Is PROJECT_ROOT set to the correct Polychron project root?"
        )


def _check_required_metrics_dirs(project_root: str) -> None:
    """output/metrics/ and log/ directories must be creatable — needed for all pipeline outputs."""
    for dirname in ("metrics", "log"):
        dirpath = os.path.join(project_root, dirname)
        try:
            os.makedirs(dirpath, exist_ok=True)
        except OSError as e:
            raise RuntimeError(f"Cannot create required directory {dirpath}: {e}") from e


def _check_registry_api_surface() -> None:
    """Scan loaded tool modules for references to Registry/ctx.mcp attributes
    that don't exist on the current Registry class.

    Catches leftover FastMCP internals (e.g. `ctx.mcp._inner._tool_manager`)
    that were the authoritative API pre-decoupling. The Registry raises
    AttributeError at call time; this check surfaces the problem at startup
    instead, after every tool_analysis module is already imported.

    Scope: attribute chains rooted at `ctx.mcp.` or `registry.` that
    (a) are NOT a `.tool(` decorator call, and
    (b) reference a name that `hasattr(Registry(), name)` returns False for.
    """
    import ast
    import glob
    from server.tool_registry import Registry
    _legit_attrs = {"tool"}  # anything the Registry class exposes by name
    probe = Registry()
    for _a in dir(probe):
        if not _a.startswith("_"):
            _legit_attrs.add(_a)

    mcp_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    offenders: list[str] = []
    for py in glob.glob(os.path.join(mcp_dir, "**", "*.py"), recursive=True):
        if "/__pycache__/" in py:
            continue
        try:
            with open(py, encoding="utf-8") as f:
                src = f.read()
            tree = ast.parse(src, filename=py)
        except (OSError, SyntaxError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Attribute):
                continue
            # Look for `ctx.mcp.X` or `registry.X` where X is the immediate attr
            chain = _attr_chain(node)
            if len(chain) < 3:
                continue
            if chain[:2] != ["ctx", "mcp"]:
                continue
            target = chain[2]
            if target in _legit_attrs:
                continue
            rel = os.path.relpath(py, mcp_dir)
            offenders.append(f"{rel}:{node.lineno} → ctx.mcp.{target}")
    if offenders:
        joined = "\n  ".join(offenders[:10])
        more = f"\n  ... and {len(offenders) - 10} more" if len(offenders) > 10 else ""
        raise RuntimeError(
            f"Registry API drift: {len(offenders)} reference(s) to ctx.mcp.<attr> "
            f"not exposed by the current Registry class:\n  {joined}{more}\n"
            f"These were likely FastMCP internals (e.g. _inner, _tool_manager) "
            f"that no longer exist after the FastMCP removal. Rewrite against "
            f"tool_registry._TOOLS / Registry.tool()."
        )


def _attr_chain(node) -> list:
    """Return the dotted-attribute chain rooted at a Name, e.g.
    `ctx.mcp.foo.bar` → ['ctx', 'mcp', 'foo', 'bar']. Returns [] for any
    non-Name-rooted chain (function call results, subscripts, etc.)."""
    import ast
    parts: list = []
    cur = node
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if not hasattr(ast, "Name") or not isinstance(cur, ast.Name):
        return []
    parts.append(cur.id)
    parts.reverse()
    return parts


def _probe_llamacpp_instance(base: str) -> str:
    """Return one of: 'healthy', 'loading', 'unreachable'.

    - 'healthy'     — GET /health returns 200 with status:ok
    - 'loading'     — port bound, any HTTP response (200 with other status,
                      or 503 "loading") — model weights still loading
    - 'unreachable' — ConnectionRefused / timeout; the server process is
                      dead or not yet spawned
    """
    import urllib.request
    import urllib.error
    try:
        with urllib.request.urlopen(f"{base}/health", timeout=5) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
            if resp.status == 200 and '"status":"ok"' in body:
                return "healthy"
            return "loading"
    except urllib.error.HTTPError:
        return "loading"  # port bound, any HTTP error counts as loading
    except Exception as _probe_err:
        logger.debug(f"llamacpp probe {base}: {type(_probe_err).__name__}: {_probe_err}")
        return "unreachable"


def _check_llamacpp_connectivity() -> None:
    """Warn if local inference models are not loaded — synthesis will fall back to templates.

    Probes the llama-server /health endpoints for arbiter (8080) and coder
    (8081). These URLs are owned exclusively by llamacpp_daemon.

    Distinguishes three states:
      healthy     — model ready for requests
      loading     — port bound, weights still loading (cold boot / restart)
      unreachable — no process listening (real failure)

    Retries briefly during warmup: if an instance is loading, we poll up to
    HME_SELFTEST_WARMUP_WAIT seconds before classifying it as still-loading.
    This avoids spurious 'unreachable' warnings immediately after a worker
    restart or daemon cold-start, when a 30B MoE model genuinely takes
    60-90s to load.
    """
    arbiter_url = ENV.require("HME_LLAMACPP_ARBITER_URL")
    coder_url   = ENV.require("HME_LLAMACPP_CODER_URL")
    warmup_wait = ENV.optional_int("HME_SELFTEST_WARMUP_WAIT", 30)
    poll_interval = 3
    import time
    deadline = time.time() + warmup_wait
    states: dict[str, str] = {}
    while True:
        for role, base in (("arbiter", arbiter_url), ("coder", coder_url)):
            if states.get(role) == "healthy":
                continue
            states[role] = _probe_llamacpp_instance(base)
        if all(v == "healthy" for v in states.values()):
            break
        if any(v == "unreachable" for v in states.values()):
            # Real failure (not loading) — no point polling further.
            break
        if time.time() >= deadline:
            break
        time.sleep(poll_interval)

    unreachable = [r for r, s in states.items() if s == "unreachable"]
    loading = [r for r, s in states.items() if s == "loading"]
    healthy = [r for r, s in states.items() if s == "healthy"]
    if unreachable:
        logger.warning(
            f"llama-server connectivity: {len(unreachable)} UNREACHABLE: {unreachable} "
            f"(no process listening). Loading: {loading}. Healthy: {healthy}."
        )
    elif loading:
        logger.warning(
            f"llama-server connectivity: {len(loading)} still LOADING after "
            f"{warmup_wait}s: {loading}. Not a failure — cold-start MoE models "
            f"can take 60-90s. Healthy: {healthy}."
        )
    else:
        logger.info(f"llama-server connectivity: OK ({', '.join(healthy)} healthy)")


# Legacy alias — some callers still import _check_llamacpp_connectivity.
_check_llamacpp_connectivity = _check_llamacpp_connectivity
