"""HME synthesis subpackage -- public re-export hub (lives in __init__.py so
the subpackage itself exposes the hub API directly, avoiding the
sys.modules alias trick that breaks importlib.reload()).

Split into focused modules:
  synthesis_config.py     -- model names, system prompt, budget tables
  synthesis_llamacpp.py   -- model constants, URLs, locks, circuit breaker, interactive_event
  synthesis_inference.py  -- _local_think, _local_chat, _local_think_with_system, compress_for_claude
  synthesis_session.py    -- think history, session narrative, disk persistence
  synthesis_warm.py       -- warm KV context, persona construction, priming
  synthesis_pipeline.py   -- arbiter triage, conflict resolution, two-stage/parallel think
"""
import logging

logger = logging.getLogger("HME")

from .synthesis_config import (  # noqa: F401
    _THINK_MODEL, _DEEP_MODEL, _build_think_system, _THINK_SYSTEM, _REVIEW_SYSTEM,
    _BUDGET_TOKENS, _BUDGET_EFFORT, _BUDGET_TOOL_CALLS, _KB_CATEGORY_ORDER,
    _get_max_tokens, _get_effort, _get_tool_budget,
)
from .synthesis_llamacpp import (  # noqa: F401
    _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL,
    _LLAMACPP_ARBITER_URL, _LLAMACPP_CODER_URL, _llamacpp_url_for,
    _interactive_event, _background_yield, route_model,
)
from .synthesis_inference import (  # noqa: F401
    _read_module_source, _local_chat, _local_think_with_system, _reasoning_think,
)
from .synthesis_cascade import synthesize, dual_gpu_consensus  # noqa: F401
# Late-binding proxies: survive hot-reload of underlying modules without stale references.
# _local_think and compress_for_claude live in synthesis_inference.py after the split;
# synthesis_llamacpp now only holds model constants, URLs, locks, and the circuit breaker.
from . import synthesis_inference as _so_inf
from . import synthesis_llamacpp as _so

def _local_think(*args, **kwargs):
    return _so_inf._local_think(*args, **kwargs)

def compress_for_claude(*args, **kwargs):
    return _so_inf.compress_for_claude(*args, **kwargs)


def ground_synthesis(*args, **kwargs):
    """Late-bound re-export of synthesis_inference.ground_synthesis."""
    return _so_inf.ground_synthesis(*args, **kwargs)


def filter_ungrounded_bullets(*args, **kwargs):
    """Late-bound re-export of synthesis_inference.filter_ungrounded_bullets."""
    return _so_inf.filter_ungrounded_bullets(*args, **kwargs)


def extract_diff_symbols(*args, **kwargs):
    """Late-bound re-export of synthesis_inference.extract_diff_symbols."""
    return _so_inf.extract_diff_symbols(*args, **kwargs)
# _last_think_failure is a mutable module-level sentinel in synthesis_llamacpp.
# Must be read via module reference (not re-exported) to get the live value after mutation.
from . import synthesis_llamacpp as _synthesis_llamacpp_mod  # noqa: F401
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
