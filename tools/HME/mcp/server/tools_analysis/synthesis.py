"""HME synthesis engine — public re-export hub.

Split into focused modules:
  synthesis_config.py   — model names, system prompt, budget tables
  synthesis_ollama.py   — _local_think, _local_chat, locks, compress_for_claude
  synthesis_session.py  — think history, session narrative, disk persistence
  synthesis_warm.py     — warm KV context, persona construction, priming
  synthesis_pipeline.py — arbiter triage, conflict resolution, two-stage/parallel think
"""
import logging

logger = logging.getLogger("HME")

from .synthesis_config import (  # noqa: F401
    _THINK_MODEL, _DEEP_MODEL, _build_think_system, _THINK_SYSTEM,
    _BUDGET_TOKENS, _BUDGET_EFFORT, _BUDGET_TOOL_CALLS, _KB_CATEGORY_ORDER,
    _get_max_tokens, _get_effort, _get_tool_budget,
)
from .synthesis_ollama import (  # noqa: F401
    _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL, _LOCAL_URL, _LOCAL_CHAT_URL, _url_for,
    _ollama_interactive,
    _ollama_background_yield, _read_module_source,
    _local_chat, _local_think_with_system,
    route_model, synthesize, dual_gpu_consensus,
)
# Late-binding proxies: survive hot-reload of synthesis_ollama without stale references.
from . import synthesis_ollama as _so

def _local_think(*args, **kwargs):
    return _so._local_think(*args, **kwargs)

def compress_for_claude(*args, **kwargs):
    return _so.compress_for_claude(*args, **kwargs)
# _last_think_failure is a mutable module-level sentinel in synthesis_ollama.
# Must be read via module reference (not re-exported) to get the live value after mutation.
from . import synthesis_ollama as _synthesis_ollama_mod  # noqa: F401
from .synthesis_session import (  # noqa: F401
    store_think_history, get_think_history_context,
    append_session_narrative, get_session_narrative,
)
from .synthesis_warm import (  # noqa: F401
    _warm_ctx, _warm_ctx_kb_ver, _warm_ctx_ts,
    _prime_warm_context, _prime_all_gpus, warm_context_status,
    ensure_warm,
)
from .synthesis_pipeline import (  # noqa: F401
    _arbiter_check, _resolve_complex_conflict,
    _two_stage_think, _parallel_two_stage_think,
)


def _think_local_or_claude(prompt: str, model: str | None = None,
                           temperature: float = 0.3, **kwargs) -> str | None:
    return _local_think(prompt, model=model, temperature=temperature)
