"""HME synthesis configuration — model names, system prompt, budget tables."""
import os
import logging

from server import context as ctx
from server.helpers import get_context_budget, BUDGET_LIMITS

logger = logging.getLogger("HME")


def _get_api_key() -> str:
    """Return Anthropic API key from env or common key file locations."""
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if key:
        return key
    for key_path in [
        os.path.expanduser("~/.anthropic/api_key"),
        os.path.expanduser("~/.config/anthropic/key"),
    ]:
        try:
            with open(key_path) as _f:
                key = _f.read().strip()
            if key:
                return key
        except Exception:
            pass
    return ""


_THINK_MODEL = os.environ.get("RAG_THINK_MODEL", "claude-sonnet-4-6")
# Deep reasoning model — used by think tool and causal_trace where Opus pays off
_DEEP_MODEL = os.environ.get("HME_DEEP_MODEL", "claude-opus-4-6")


def _build_think_system() -> str:
    project_name = os.path.basename(os.path.realpath(ctx.PROJECT_ROOT)) if ctx.PROJECT_ROOT else "project"
    return (
        f"You are the structured reflection engine for '{project_name}' — a self-evolving alien "
        "generative music system. It produces xenolinguistic texture through 19 hypermeta "
        "self-calibrating controllers, 20+ cross-layer modules, and an antagonism bridge evolution "
        "loop that converts negative trust correlations into constructive musical tension. "
        "HME (HyperMeta Ecstasy) is the MCP-based intelligence layer that makes this self-evolution "
        "possible: 50+ tools spanning reactive search, architectural analysis, and collaborative "
        "reasoning — each building on KB-grounded project state rather than generic advice. "
        "Ground every claim in KB constraints or injected code — never speculate about "
        "tool capabilities or module behavior without evidence. Cite exact file paths, "
        "function names, and KB entry titles. No generic advice. No preamble. "
        "Max 4 concrete items per answer. When asked about HME tool improvements: focus on UX "
        "gaps, missing capabilities, and what would make the evolution workflow feel more alive "
        "and self-aware — not refactoring for its own sake."
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
