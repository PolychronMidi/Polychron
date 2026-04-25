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

# Code-review system prompt — calibrated against patterns that produced
# real-bug signal vs hallucination during the 100-iteration sweep across
# the HME codebase.
#
# Empirical findings on what extracts useful signal from the persistent
# Opus thread (and likely from any sufficiently-capable reviewer LLM):
#
#   - PERMISSION TO CLEAR: prompts that explicitly allow "clean" / "no
#     tier-1 issues" / "95%+ confidence only" produced calibrated honest
#     answers. Prompts that read as "find the worst..." returned
#     finding-shaped text regardless of whether bugs existed.
#
#   - QUOTE-GROUND: requiring the reviewer to QUOTE the suspicious line
#     verbatim before reasoning about it dramatically reduces line-number
#     hallucination. "Cite file:line" alone wasn't enough — the reviewer
#     would invent the line content. "Quote the line + explain why" works.
#
#   - PROMISE-VS-DELIVERS: the strongest single framing was "compare the
#     file's docstring/comments to its actual behavior — find divergence."
#     Three real divergences in cascade_analysis.py, two in
#     posttooluse_hme_review.sh, all confirmed.
#
#   - TIER-GATED: "Tier-1 (confirmed bug) only" produced honest "no tier-1
#     issues found" responses on clean files. Without the tier gate, every
#     prompt produced a vector regardless of code quality.
#
#   - LEADING PROMPTS POISON SIGNAL: "Find the worst non-obvious failure
#     mode" or "Find code that's clever enough to obscure a subtle bug"
#     consistently produced low-confidence inventions. The reviewer
#     pattern-matches the framing, not the code.
#
# This system prompt bakes those four positive patterns in. Per-call
# user prompts can still narrow the focus, but the framing here makes
# "clean" a first-class answer and grounds every claim.
_REVIEW_SYSTEM = (
    "You are a code reviewer. For each issue you flag, you MUST: "
    "(1) quote the offending line(s) verbatim from the file, "
    "(2) explain why what the code does diverges from what its name/"
    "docstring/comments imply or what a calling site assumes, "
    "(3) cite file:line. "
    "Use a tier system: TIER-1 = confirmed bug or contract violation; "
    "skip TIER-2/TIER-3 entirely. "
    # The test for flagging is STRUCTURAL, not probabilistic: if you can
    # quote a line AND state a specific divergence it creates, flag it.
    # A prior iteration used a ≥95%-confidence floor, but self-reported
    # LM confidence is unmeasurable, and that framing pushed toward
    # silence on exactly the subtle contract/promise divergences this
    # reviewer exists to catch (peer-review iter 105 caught this as an
    # asymmetric-reward problem: cheap to stay silent, costly to defend
    # a 70-90% finding that's actually correct). Quote+divergence is a
    # binary gate a reviewer CAN reliably answer.
    "Say 'no tier-1 issues' ONLY if no line in scope admits a quote + "
    "specific-divergence pair. Not because you feel uncertain — "
    "uncertainty about whether a quoted divergence is a 'real bug' is "
    "what the human reviewer resolves; your job is to surface the "
    "quote+divergence pairs you can actually construct. "
    "No generic advice. No preamble. No architectural commentary unless "
    "the prompt asks for it. Max 4 items."
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
