"""HME synthesis engine — public re-export hub.

Split into focused modules:
  synthesis_config.py  — model names, system prompt, budget tables
  synthesis_ollama.py  — Ollama: _local_think, _local_chat, _two_stage_think,
                         _parallel_two_stage_think, warm KV context, arbiter,
                         think history, unified session narrative
"""
import logging

logger = logging.getLogger("HME")

# Re-export config layer
from .synthesis_config import (  # noqa: F401
    _THINK_MODEL, _DEEP_MODEL, _build_think_system, _THINK_SYSTEM,
    _BUDGET_TOKENS, _BUDGET_EFFORT, _BUDGET_TOOL_CALLS, _KB_CATEGORY_ORDER,
    _get_max_tokens, _get_effort, _get_tool_budget,
)

# Re-export Ollama layer
from .synthesis_ollama import (  # noqa: F401
    _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL, _LOCAL_URL, _LOCAL_CHAT_URL,
    _ollama_interactive, _ollama_lock, _gpu0_lock, _gpu1_lock,
    _ollama_background_yield, _local_think, _read_module_source,
    _local_chat, _local_think_with_system,
    _two_stage_think, _parallel_two_stage_think,
    _prime_warm_context, _prime_all_gpus, warm_context_status,
    _arbiter_check, _resolve_complex_conflict,
    store_think_history, get_think_history_context,
    append_session_narrative, get_session_narrative,
    compress_for_claude,
)


def _think_local_or_claude(prompt: str, model: str | None = None,
                           temperature: float = 0.3,
                           **kwargs) -> str | None:
    """Call local model for synthesis tasks.

    model: override the default _LOCAL_MODEL (e.g. pass _REASONING_MODEL for creative prose).
    temperature: override default 0.3 (use 0.5+ for creative/critique tasks).
    """
    return _local_think(prompt, model=model, temperature=temperature)
