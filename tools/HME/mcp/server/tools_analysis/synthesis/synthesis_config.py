"""HME synthesis configuration — model names, system prompt, budget tables, shared text helpers."""
import json
import os
import re
import logging

from server import context as ctx
from server.helpers import get_context_budget, BUDGET_LIMITS

logger = logging.getLogger("HME")


# These names are retained for import compatibility (callers import them by name).
# All synthesis goes through llama.cpp — see synthesis_llamacpp.py for _LOCAL_MODEL/_REASONING_MODEL.
_THINK_MODEL = "llamacpp/qwen3-coder:30b"
_DEEP_MODEL = "llamacpp/qwen3:30b-a3b"


def _build_think_system() -> str:
    project_name = os.path.basename(os.path.realpath(ctx.PROJECT_ROOT)) if ctx.PROJECT_ROOT else "project"
    return (
        f"You are the structured reflection engine for '{project_name}' — a self-evolving alien "
        "generative music system producing xenolinguistic texture. Architecture: 19 hypermeta "
        "self-calibrating controllers, 26 cross-layer modules, and an antagonism bridge evolution "
        "loop that converts negative trust correlations into constructive musical tension via "
        "coupling BOTH modules of a negatively-correlated pair to the SAME signal with OPPOSING "
        "effects. Evolution verdicts: LEGENDARY > STABLE > EVOLVED > DRIFTED. "
        "HME (HyperMeta Ecstasy) is the llama.cpp-powered MCP intelligence layer: 26 tools spanning "
        "reactive search (search_code, find_callers, grep), architectural analysis (module_intel, "
        "coupling_intel, codebase_health), pre/post-edit workflow (before_editing, what_did_i_forget), "
        "and synthesis (think, pipeline_digest, suggest_evolution, diagnose_error). "
        "All synthesis runs on local llama.cpp: qwen3-coder:30b (GPU0, extraction) + "
        "qwen3:30b-a3b (GPU1, reasoning) — parallel two-stage for evolution questions, "
        "single-stage for meta-HME and constraint questions. "
        "Ground every claim in KB constraints or injected code. "
        "Cite exact file paths, function names, and KB entry titles. "
        "No generic advice. No preamble. Max 4 concrete items per answer."
    )


_THINK_SYSTEM = _build_think_system()

# Focused system prompt for diff/code-review paths. The generic
# _THINK_SYSTEM above is project-marketing boilerplate (19 hypermeta
# controllers, antagonism bridges, xenolinguistic texture) — useful
# context for architectural-synthesis tools but pure bloat for a
# "scan this diff for bugs" path. Reviewers get this stripped version
# instead.
_REVIEW_SYSTEM = (
    "You are a code reviewer. Flag concrete bugs in the given diff. "
    "Cite file:line for every claim. No generic advice, no preamble, "
    "no architectural commentary. Max 4 items."
)

# Planner persona — round-opening subagent. Produces a Spec.md for the
# upcoming round. Hardened against the generic "jump to implementation"
# pull: the Planner's only job is to enumerate what should change and
# why, grounded in last verdict + KB. No code.
_PLANNER_SYSTEM = (
    "You are the Planner for this Polychron round. Your only output is "
    "a markdown specification: what should change in this round, why, "
    "grounded in the prior round's verdict/fingerprint and any relevant "
    "KB entries. Do NOT write code. Do NOT suggest implementations. Do "
    "NOT propose more than 3 concrete changes. Cite: prior verdict, "
    "fingerprint delta, KB ID(s) supporting each proposal. Return only "
    "the spec."
)

# Evaluator persona — round-closing subagent. Hardened against Claude's
# efficiency defaults: reads full files (not diffs), gathers evidence
# per criterion, re-verifies every round, returns BLOCKED when
# verification cannot be performed. Pairs with _PLANNER_SYSTEM's spec
# as the contract to verify against.
_VERIFY_SYSTEM = (
    "You are the Evaluator for this Polychron round. Your job: verify "
    "the implementation against the round's Spec.md. Read the FULL "
    "changed files (not just the diff). Gather concrete evidence for "
    "every spec criterion. Run i/prove on any architectural invariant "
    "claims. Check the pipeline verdict if available. Return exactly "
    "one of: PASS (with evidence per criterion), FAIL (with specific "
    "violations, file:line), or BLOCKED (with what couldn't be verified "
    "and why). Do NOT optimize for brevity. Do NOT skip criteria. Do "
    "NOT accept 'looks right' as evidence."
)


# Single ceiling for local model generation. qwen3-coder:30b fully GPU-resident
# on the M40 can handle 8K output without VRAM pressure (context window is the
# VRAM-bound constraint, not generation length). Tune this one value; the
# budget tiers scale proportionally via _BUDGET_TOKEN_SCALE.
_BUDGET_TOKEN_CEILING = 8192
_BUDGET_TOKEN_SCALE = {"greedy": 1.0, "moderate": 0.5, "conservative": 0.25, "minimal": 1/32}
_BUDGET_TOKENS = {k: max(64, int(_BUDGET_TOKEN_CEILING * s)) for k, s in _BUDGET_TOKEN_SCALE.items()}
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


# Shared text processing helpers
# Used by all synthesis modules. Single source of truth for response cleanup.

_THINK_RE = re.compile(
    r'```(?:thinking|reasoning)\b[\s\S]*?```'  # fenced thinking blocks
    r'|<\|thinking\|>[\s\S]*?<\|/thinking\|>'  # pipe-delimited thinking
    r'|<think>[\s\S]*?</think>',                # XML thinking
    re.IGNORECASE,
)
_CHATML_ASST_RE = re.compile(
    r'<\|im_start\|>assistant\s*([\s\S]*?)(?:<\|im_end\|>|$)',
    re.IGNORECASE,
)
_CHATML_TAG_RE = re.compile(r'<\|im_start\|>[\s\S]*?<\|im_end\|>')
_NON_ASCII_RE = re.compile(r'[^\x00-\x7F]+')


def strip_thinking_tags(text: str) -> str:
    """Remove all thinking/reasoning markup from model output.

    Handles: ```thinking...```, <think>...</think>, <|thinking|>...<|/thinking|>,
    <|answer|> delimiters, and ChatML <|im_start|>/<|im_end|> wrappers.
    """
    if not text:
        return ""
    # Fenced + XML thinking blocks
    text = _THINK_RE.sub('', text).strip()
    # <|answer|> delimiter — keep only content after it
    if "<|answer|>" in text:
        text = text[text.rfind("<|answer|>") + len("<|answer|>"):].strip()
    # Bare </think> without opening tag (streaming artifact)
    if "</think>" in text:
        text = text[text.rfind("</think>") + len("</think>"):].strip()
    elif "<think>" in text:
        before = text[:text.find("<think>")].strip()
        text = before if before else ""
    # ChatML tags
    if "<|im_start|>" in text:
        m = _CHATML_ASST_RE.findall(text)
        if m:
            text = m[-1].strip()
        else:
            text = _CHATML_TAG_RE.sub('', text).strip()
            text = text.replace("<|im_start|>", "").replace("<|im_end|>", "").strip()
    return text


def strip_non_ascii(text: str) -> str:
    """Remove non-ASCII characters (emoji, CJK, etc.)."""
    return _NON_ASCII_RE.sub('', text).strip() if text else ""


def clean_model_output(text: str) -> str:
    """Full cleanup pipeline: thinking tags → non-ASCII → whitespace."""
    text = strip_thinking_tags(text)
    text = strip_non_ascii(text)
    return text


def load_json(rel_path: str, default=None):
    """Load JSON from a project-relative path with standard error handling."""
    path = os.path.join(ctx.PROJECT_ROOT, rel_path) if not os.path.isabs(rel_path) else rel_path
    if not os.path.isfile(path):
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, ValueError):
        return default


def load_jsonl(rel_path: str, lookback: int | None = 500) -> list[dict]:
    """Load JSONL events from a project-relative path. Returns last N entries."""
    path = os.path.join(ctx.PROJECT_ROOT, rel_path) if not os.path.isabs(rel_path) else rel_path
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()[-lookback:] if lookback else f.readlines()
    except OSError:
        return []
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out
