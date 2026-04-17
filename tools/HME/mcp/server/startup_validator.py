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
    """metrics/ and log/ directories must be creatable — needed for all pipeline outputs."""
    for dirname in ("metrics", "log"):
        dirpath = os.path.join(project_root, dirname)
        try:
            os.makedirs(dirpath, exist_ok=True)
        except OSError as e:
            raise RuntimeError(f"Cannot create required directory {dirpath}: {e}") from e


def _check_llamacpp_connectivity() -> None:
    """Warn if local inference models are not loaded — synthesis will fall back to templates.

    Probes the llama-server /health endpoints for arbiter (8080) and coder
    (8081). These URLs are owned by llamacpp_daemon + llamacpp_supervisor.
    """
    import urllib.request

    arbiter_url = ENV.require("HME_LLAMACPP_ARBITER_URL")
    coder_url   = ENV.require("HME_LLAMACPP_CODER_URL")
    failed = []
    for role, base in (("arbiter", arbiter_url), ("coder", coder_url)):
        try:
            with urllib.request.urlopen(f"{base}/health", timeout=3) as resp:
                body = resp.read().decode("utf-8", errors="ignore")
                if resp.status != 200 or '"status":"ok"' not in body:
                    failed.append(f"{role}@{base}")
        except Exception as e:
            failed.append(f"{role}@{base} ({type(e).__name__})")
    if failed:
        logger.warning(f"llama-server connectivity: {len(failed)} instance(s) unreachable: {failed}")
    else:
        logger.info("llama-server connectivity: OK (arbiter + coder healthy)")


# Legacy alias — some callers still import _check_llamacpp_connectivity.
_check_llamacpp_connectivity = _check_llamacpp_connectivity
