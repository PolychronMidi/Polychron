"""HME startup self-test — fail-fast validation after engines are initialized.

Runs once after _background_load() completes. Any failure here aborts startup by
raising into _startup_error, ensuring tools crash loudly rather than silently
returning degraded output.

Philosophy: mirrors src/ fail-fast (loud crashes, never silent corruption).
"""
import os
import logging

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
    _check_ollama_connectivity()  # warning only — Ollama may start later
    logger.info("HME startup validation PASSED")


def _check_engines(context) -> None:
    """All three required engines must be initialized and functional."""
    if context.project_engine is None:
        raise RuntimeError("project_engine is None — RAGEngine failed to initialize")
    if context.global_engine is None:
        raise RuntimeError("global_engine is None — RAGEngine failed to initialize")
    if context.shared_model is None:
        raise RuntimeError("shared_model is None — SentenceTransformer failed to load")

    # In proxy mode the shim owns the model — its health check already verified readiness.
    # Skip the smoke-test that would make an HTTP round-trip before the shim is fully warm.
    from server.rag_proxy import RAGProxy, _ModelProxy
    if isinstance(context.project_engine, RAGProxy):
        return

    # Smoke-test: ensure the embedding model actually works (local mode only)
    try:
        result = context.shared_model.encode(["test"], show_progress_bar=False)
        if result is None or len(result) == 0:
            raise RuntimeError("shared_model.encode returned empty result")
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


def _check_ollama_connectivity() -> None:
    """Warn if any Ollama instance is not reachable — synthesis will fall back to templates.

    Checks all three instances: GPU0 (extractor), GPU1 (reasoner), CPU (arbiter).
    Non-fatal: Ollama may not be running yet, or may be on a different host.
    Logs a warning per unreachable instance so failures are visible, not silent.
    """
    import urllib.request
    import urllib.error
    instances = [
        (int(os.environ.get("HME_OLLAMA_PORT_GPU0", "11434")), "GPU0 extractor"),
        (int(os.environ.get("HME_OLLAMA_PORT_GPU1", "11435")), "GPU1 reasoner"),
        (int(os.environ.get("HME_OLLAMA_PORT_CPU",  "11436")), "CPU arbiter"),
    ]
    ok_count = 0
    for port, role in instances:
        url = f"http://localhost:{port}/api/tags"
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                if resp.status == 200:
                    ok_count += 1
                    continue
        except urllib.error.URLError as e:
            logger.warning(f"Ollama {role} not reachable at localhost:{port} ({e})")
        except Exception as e:
            logger.warning(f"Ollama {role} connectivity check failed at localhost:{port}: {type(e).__name__}: {e}")
    if ok_count == len(instances):
        logger.info(f"Ollama connectivity: OK (all {len(instances)} instances)")
    elif ok_count > 0:
        logger.warning(f"Ollama connectivity: {ok_count}/{len(instances)} instances reachable — synthesis degraded")
    else:
        logger.warning("Ollama connectivity: NO instances reachable — synthesis will use template fallback")
