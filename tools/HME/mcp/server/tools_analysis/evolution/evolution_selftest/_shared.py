"""HME self-test and hot-reload — tool registration, doc sync, index integrity, llama.cpp health."""
import os
import logging
import sys
import importlib

# Path up four levels to reach tools/HME/mcp/ (post-split the file sits
# at mcp/server/tools_analysis/evolution/evolution_selftest/_shared.py).
_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402

from server import context as ctx
# Post-split: depth increased by 1, so `..` → `...` for cross-package refs.
from ...synthesis import _local_think
from ... import _track

logger = logging.getLogger("HME")

# All reloadable tool modules (kept here so hme_selftest can inspect coverage via getsource).
RELOADABLE = [
    # NOTE: the three subpackage names (synthesis / evolution / coupling)
    # are deliberately absent — these subpackages ARE their hub (hub code
    # lives in __init__.py, not a sibling .py file), so reloading them
    # happens via reload of the subpackage itself which is not a typical
    # hot-reload target. Reloading individual submodules inside the
    # subpackage works because the _alias_subpackage function now skips
    # self-name collisions (see tools_analysis/__init__.py), preserving
    # __path__ on the subpackage.
    "synthesis_config", "synthesis_llamacpp", "synthesis_gemini",
    "synthesis_groq", "synthesis_openrouter", "synthesis_cerebras",
    "synthesis_mistral", "synthesis_nvidia", "synthesis_reasoning",
    "synthesis_session", "synthesis_warm", "synthesis_pipeline", "synthesis_proxy_route",
    "synthesis_inference", "synthesis_cascade", "synthesis_provider_base",
    "request_coordinator",
    "warm_disk", "warm_persona",
    "tool_cache",
    "symbols", "workflow", "workflow_audit",
    "reasoning", "reasoning_think",
    "health",
    "evolution_next", "evolution_suggest",
    "evolution_trace", "evolution_strategies",
    "evolution_admin", "evolution_introspect", "evolution_selftest",
    "runtime", "composition", "trust_analysis",
    "digest", "digest_analysis",
    "section_compare", "perceptual", "perceptual_engines",
    "coupling_channels", "coupling_data", "coupling_clusters", "coupling_bridges",
    "drama_map", "health_analysis", "section_labels",
    "evolution_evolve", "evolution_invariants", "search_unified", "review_unified",
    "read_unified", "learn_unified", "status_unified", "trace_unified",
    "todo", "enrich_prompt", "tools_passthru", "activity_digest", "blindspots",
    "cascade_analysis", "hypothesis_registry", "prediction_accuracy",
    "semantic_drift_report", "crystallizer", "self_audit", "probe",
    "epistemic_reports", "negative_space", "cognitive_load", "ground_truth",
    "phase6_reports", "multi_agent", "discovery_promote",
]
TOP_LEVEL_RELOADABLE = ["tools_search", "tools_knowledge",
                        "meta_layers", "meta_observer"]
ROOT_RELOADABLE = ["file_walker", "lang_registry", "chunker", "structure"]


