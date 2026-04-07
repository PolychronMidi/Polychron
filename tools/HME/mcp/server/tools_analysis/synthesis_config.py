"""HME synthesis configuration — model names, system prompt, budget tables."""
import os
import logging

from server import context as ctx
from server.helpers import get_context_budget, BUDGET_LIMITS

logger = logging.getLogger("HME")


# These names are retained for import compatibility (callers import them by name).
# All synthesis goes through Ollama — see synthesis_ollama.py for _LOCAL_MODEL/_REASONING_MODEL.
_THINK_MODEL = "ollama/qwen3-coder:30b"
_DEEP_MODEL = "ollama/qwen3:30b-a3b"


def _build_think_system() -> str:
    project_name = os.path.basename(os.path.realpath(ctx.PROJECT_ROOT)) if ctx.PROJECT_ROOT else "project"
    return (
        f"You are the structured reflection engine for '{project_name}' — a self-evolving alien "
        "generative music system producing xenolinguistic texture. Architecture: 19 hypermeta "
        "self-calibrating controllers, 26 cross-layer modules, and an antagonism bridge evolution "
        "loop that converts negative trust correlations into constructive musical tension via "
        "coupling BOTH modules of a negatively-correlated pair to the SAME signal with OPPOSING "
        "effects. Evolution verdicts: LEGENDARY > STABLE > EVOLVED > DRIFTED. "
        "HME (HyperMeta Ecstasy) is the Ollama-powered MCP intelligence layer: 26 tools spanning "
        "reactive search (search_code, find_callers, grep), architectural analysis (module_intel, "
        "coupling_intel, codebase_health), pre/post-edit workflow (before_editing, what_did_i_forget), "
        "and synthesis (think, pipeline_digest, suggest_evolution, diagnose_error). "
        "All synthesis runs on local Ollama: qwen3-coder:30b (GPU0, extraction) + "
        "qwen3:30b-a3b (GPU1, reasoning) — parallel two-stage for evolution questions, "
        "single-stage for meta-HME and constraint questions. "
        "Ground every claim in KB constraints or injected code. "
        "Cite exact file paths, function names, and KB entry titles. "
        "No generic advice. No preamble. Max 4 concrete items per answer."
    )


_THINK_SYSTEM = _build_think_system()


_BUDGET_TOKENS = {"greedy": 4096, "moderate": 2048, "conservative": 1024, "minimal": 256}
_BUDGET_EFFORT = {"greedy": "high", "moderate": "medium", "conservative": "low", "minimal": "low"}
_BUDGET_TOOL_CALLS = {"greedy": 12, "moderate": 6, "conservative": 3, "minimal": 0}

_KB_CATEGORY_ORDER = {"architecture": 0, "decision": 1, "pattern": 2, "bugfix": 3, "general": 4}


def _get_max_tokens(default: int = 1024) -> int:
    """Scale max_tokens by remaining context window pressure."""
    budget = get_context_budget()
    return _BUDGET_TOKENS.get(budget, default)


def _get_effort() -> str:
    """Map context budget to output_config.effort level."""
    budget = get_context_budget()
    return _BUDGET_EFFORT.get(budget, "medium")


def _get_tool_budget() -> int:
    """Map context budget to synthesis tool-call ceiling."""
    return _BUDGET_TOOL_CALLS.get(get_context_budget(), 6)
