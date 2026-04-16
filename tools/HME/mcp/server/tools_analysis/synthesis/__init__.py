"""Synthesis subpackage — inference providers and session management."""
# Re-export everything so parent sys.modules aliasing works.
from .synthesis import *  # noqa: F401,F403
from .synthesis_config import *  # noqa: F401,F403
from .synthesis_session import *  # noqa: F401,F403
# Split modules — re-export key functions at package level
from .synthesis_inference import (  # noqa: F401
    _local_think, _local_chat, _reasoning_think,
    _local_think_with_system, _read_module_source,
    compress_for_claude, _cancellable_urlopen,
)
from .synthesis_cascade import (  # noqa: F401
    synthesize, dual_gpu_consensus,
    _cascade_synthesis, _assess_complexity, _quality_gate,
    _inject_context, _fuzzy_find_modules,
)
