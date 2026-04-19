"""HME analysis tools — split into focused modules.

Import order matters: synthesis first (no tool dependencies), then modules that
register @ctx.mcp.tool() decorators. All tools auto-register at import time.
"""
import os
import logging

from server import context as ctx

logger = logging.getLogger("HME")

# Shared helpers — re-exported so `from . import _track, _budget_gate` works
from ._helpers import (  # noqa: F401
    _track, _usage_stats, get_session_intent,
    BUDGET_TOOL, BUDGET_COMPOUND, BUDGET_SECTION, BUDGET_LOCAL_THINK,
    _budget_gate, _budget_section, _budget_local_think,
    _cap_code_blocks, _cap_list_items,
    _filter_kb_relevance, _get_compositional_context,
    _compositional_context_cache,
    _git_run, _load_trace, _trace_cache, _git_cache,
)



import sys as _sys
_PKG = __name__


def _alias_subpackage(subpkg_name, module_names):
    """Register sys.modules aliases so `from .module_name import X` works
    even though module_name.py moved into a subpackage directory.

    HARD RULE: never alias `name == subpkg_name` — that would overwrite
    the subpackage entry in sys.modules with a plain .py module (no
    __path__), which breaks importlib.reload() for every submodule whose
    parent resolves back through this key. The hub API for each subpackage
    lives in the subpackage __init__.py, so `from ..{subpkg} import X`
    already works without an alias at the collision name."""
    for name in module_names:
        if name == subpkg_name:
            continue
        mod = _sys.modules.get(f"{_PKG}.{subpkg_name}.{name}")
        if mod:
            _sys.modules[f"{_PKG}.{name}"] = mod
    # Post-assertion: the subpackage itself must still resolve to a real
    # package object with __path__ attached. If a future refactor
    # accidentally re-introduces the name collision, we want to crash
    # loudly at import time, not discover it later through mysterious
    # importlib.reload() failures on every submodule.
    _pkg_entry = _sys.modules.get(f"{_PKG}.{subpkg_name}")
    if _pkg_entry is not None and not hasattr(_pkg_entry, "__path__"):
        raise RuntimeError(
            f"_alias_subpackage: sys.modules[{_PKG}.{subpkg_name!r}] lost "
            f"__path__ — a .py module is clobbering the subpackage entry. "
            f"This silently breaks importlib.reload() for every submodule. "
            f"Check the alias list for a self-name collision."
        )


# Import order: subpackages first (subpackage __init__.py is the hub), then flat modules
from . import tool_cache  # noqa: E402, F401

# synthesis/ — the subpackage __init__ IS the hub (was synthesis.py; inlined to fix reload).
from . import synthesis  # noqa: E402, F401
from .synthesis import synthesis_config  # noqa: E402, F401
from .synthesis import synthesis_llamacpp  # noqa: E402, F401
from .synthesis import synthesis_inference  # noqa: E402, F401
from .synthesis import synthesis_cascade  # noqa: E402, F401
from .synthesis import synthesis_provider_base  # noqa: E402, F401
from .synthesis import synthesis_proxy_route  # noqa: E402, F401
from .synthesis import synthesis_session  # noqa: E402, F401
from .synthesis import synthesis_warm  # noqa: E402, F401
from .synthesis import synthesis_pipeline  # noqa: E402, F401
from .synthesis import synthesis_reasoning  # noqa: E402, F401
from .synthesis import synthesis_groq  # noqa: E402, F401
from .synthesis import synthesis_cerebras  # noqa: E402, F401
from .synthesis import synthesis_mistral  # noqa: E402, F401
from .synthesis import synthesis_nvidia  # noqa: E402, F401
from .synthesis import synthesis_openrouter  # noqa: E402, F401
from .synthesis import synthesis_gemini  # noqa: E402, F401
_alias_subpackage("synthesis", [
    "synthesis_cerebras", "synthesis_config", "synthesis_gemini",
    "synthesis_groq", "synthesis_llamacpp", "synthesis_mistral", "synthesis_nvidia",
    "synthesis_openrouter", "synthesis_pipeline", "synthesis_proxy_route",
    "synthesis_reasoning", "synthesis_session", "synthesis_warm",
    "synthesis_inference", "synthesis_cascade", "synthesis_provider_base",
])

# coupling/ — subpackage __init__ IS the hub.
from . import coupling  # noqa: E402, F401
from .coupling import coupling_bridges  # noqa: E402, F401
from .coupling import coupling_channels  # noqa: E402, F401
from .coupling import coupling_clusters  # noqa: E402, F401
from .coupling import coupling_data  # noqa: E402, F401
_alias_subpackage("coupling", [
    "coupling_bridges", "coupling_channels",
    "coupling_clusters", "coupling_data",
])

# evolution/ — subpackage __init__ IS the hub.
from . import evolution  # noqa: E402, F401
from .evolution import evolution_admin  # noqa: E402, F401
from .evolution import evolution_evolve  # noqa: E402, F401
from .evolution import evolution_introspect  # noqa: E402, F401
from .evolution import evolution_invariants  # noqa: E402, F401
from .evolution import evolution_next  # noqa: E402, F401
from .evolution import evolution_selftest  # noqa: E402, F401
from .evolution import evolution_suggest  # noqa: E402, F401
from .evolution import evolution_trace  # noqa: E402, F401
from .evolution import evolution_strategies  # noqa: E402, F401
_alias_subpackage("evolution", [
    "evolution_admin", "evolution_evolve", "evolution_introspect",
    "evolution_invariants", "evolution_next", "evolution_selftest",
    "evolution_suggest", "evolution_trace", "evolution_strategies",
])

# Flat modules (import after subpackages are aliased)
from . import symbols          # noqa: E402, F401
from . import workflow         # noqa: E402, F401
from . import workflow_audit   # noqa: E402, F401
from . import reasoning        # noqa: E402, F401
from . import reasoning_think  # noqa: E402, F401
from . import health           # noqa: E402, F401
from . import runtime          # noqa: E402, F401
from . import composition      # noqa: E402, F401
from . import trust_analysis   # noqa: E402, F401
from . import digest           # noqa: E402, F401
from . import section_compare  # noqa: E402, F401
from . import perceptual       # noqa: E402, F401
from . import review_unified   # noqa: E402, F401
from . import read_unified     # noqa: E402, F401
from . import learn_unified    # noqa: E402, F401
from . import status_unified   # noqa: E402, F401
from . import trace_unified    # noqa: E402, F401
from . import agent_unified    # noqa: E402, F401
from . import todo             # noqa: E402, F401
from . import enrich_prompt    # noqa: E402, F401
from . import tools_passthru   # noqa: E402, F401

# Re-export synthesis functions for tools_knowledge.py compatibility
from .synthesis import (  # noqa: E402, F401
    _local_think, _think_local_or_claude,
    _THINK_MODEL, _get_max_tokens, _get_effort, _get_tool_budget,
)
