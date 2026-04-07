"""HME synthesis engine — public re-export hub.

Split into focused modules:
  synthesis_config.py  — model names, system prompt, budget tables, _get_api_key
  synthesis_claude.py  — Claude API: _claude_think, _fast_claude, _format_kb_corpus, _warm_cache
  synthesis_ollama.py  — Ollama: _local_think, _local_chat, _two_stage_think, _parallel_two_stage_think
"""
import logging

logger = logging.getLogger("HME")

# Re-export config layer
from .synthesis_config import (  # noqa: F401
    _get_api_key, _THINK_MODEL, _DEEP_MODEL, _build_think_system, _THINK_SYSTEM,
    _BUDGET_TOKENS, _BUDGET_EFFORT, _BUDGET_TOOL_CALLS, _KB_CATEGORY_ORDER,
    _get_max_tokens, _get_effort, _get_tool_budget,
)

# Re-export Claude layer
from .synthesis_claude import (  # noqa: F401
    _SYNTHESIS_TOOLS, _dispatch_synthesis_tool, _format_kb_corpus,
    _claude_think, _FAST_MODEL, _fast_claude, _warm_cache,
)

# Re-export Ollama layer
from .synthesis_ollama import (  # noqa: F401
    _LOCAL_MODEL, _REASONING_MODEL, _LOCAL_URL, _LOCAL_CHAT_URL,
    _ollama_interactive, _ollama_lock, _gpu0_lock, _gpu1_lock,
    _ollama_background_yield, _local_think, _read_module_source,
    _local_chat, _local_think_with_system,
    _two_stage_think, _parallel_two_stage_think,
)


def _think_local_or_claude(prompt: str, api_key: str,
                           local_model: str | None = None,
                           local_temperature: float = 0.3,
                           **claude_kwargs) -> str | None:
    """Try local model first for mechanical tasks. Fall back to Claude if unavailable.

    local_model: override the default _LOCAL_MODEL (e.g. pass _REASONING_MODEL for creative prose).
    local_temperature: override default 0.3 (use 0.5+ for creative/critique tasks).
    """
    result = _local_think(prompt, model=local_model, temperature=local_temperature)
    if result:
        return result
    if api_key:
        return _claude_think(prompt, api_key, **claude_kwargs)
    return None
