"""Adaptive multi-stage synthesis -- complexity assessment, context injection, cascade.

Split from synthesis_llamacpp.py. Contains synthesize() (the highest-quality
inference path in HME), cascade_synthesis, complexity assessment, quality gate,
and dual_gpu_consensus.
"""
import json
import os
import re
import logging
import threading as _threading

from server import context as ctx
from .synthesis_config import _THINK_SYSTEM
from .synthesis_llamacpp import (  # noqa: F401
    _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL,
    _KEEP_ALIVE, _NUM_CTX_4B, route_model,
)
from .synthesis_inference import (  # noqa: F401
    _local_think, _local_think_with_system, _reasoning_think,
    _read_module_source,
)

logger = logging.getLogger("HME")

from hme_env import ENV  # noqa: E402

# Adaptive multi-stage synthesis

_DEEP_SIGNALS = frozenset({
    "relationship", "interact", "coupling", "architectur",
    "design", "trade-off", "tradeoff", "feedback", "resonance",
    "implicat", "independen", "coheren",
    "how does", "why does", "what happens",
})
_MOD_SIGNALS = frozenset({
    "between", "multiple", "across", "cascad", "boundar",
    "compar", "contrast", "behavior", "detect", "trace", "tracin",
    "understand", "flow", "sequence", "lifecycle", "coordinat",
})
_SIMPLE_SIGNALS = frozenset({
    "where is", "find", "what file", "show me", "list",
    "which module", "path to", "definition of", "callers of",
})


_patterns_cache: dict | None = None
_patterns_cache_ts: float = 0.0
_PATTERNS_CACHE_TTL = 300  # 5 minutes




def _cascade_synthesis(prompt: str, enriched_prompt: str,
                       max_tokens: int = 8192) -> str | None:
    """Three-stage: arbiter plan -> coder kickstart -> reasoner deep synthesis.

    The coder provides verified structural facts (file paths, function names,
    signal fields). The reasoner uses those as grounded context for deep analysis,
    preventing hallucinated module names while enabling rich architectural reasoning.

    Grounding chain (all three must provide at least one source):
    1. Pre-discovery: fuzzy module search -> source in enriched_prompt
    2. Arbiter plan: given module registry -> names real modules -> source injection
    3. Stage 2 coder: receives BOTH pre-discovered AND plan-derived sources
    """
    from .synthesis_config import _THINK_SYSTEM

    # Extract pre-discovered sources already in enriched_prompt (from _inject_context)
    # These exist even when prompt has no camelCase module names (fuzzy discovery ran).
    _pre_sources = re.findall(r'\[Source: \w+\]\n[\s\S]*?(?=\[Source:|\[Health:|\Z)', enriched_prompt)
    _pre_source_block = "\n".join(_pre_sources[:2])[:3000]

    from .synthesis_cascade import _fuzzy_find_modules
    _registry_mods = _fuzzy_find_modules(prompt, max_results=12)
    _registry_hint = (
        f"\nKnown project modules (use exact names): {', '.join(_registry_mods)}"
        if _registry_mods else ""
    )

    # Stage 1: Arbiter plans the investigation -- context-aware via module registry
    plan = _local_think_with_system(
        f"Break into 3-5 investigation steps:\n\n{prompt[:400]}"
        f"{_registry_hint}\n\n"
        "Each step: WHAT (exact module name from list above), WHERE (subsystem), WHY (relevance).\n"
        "CRITICAL: ONLY use module names from the Known list above. If the question mentions "
        "a module not in the list, say 'not in registry' -- do NOT guess or assume it exists.",
        "Code investigation planner. ONLY reference modules from the Known list. "
        "If a module is not in the list, refuse -- say 'not in registry'. Never invent paths or locations.",
        500, _ARBITER_MODEL,
    )
    from .synthesis_config import strip_thinking_tags
    plan = strip_thinking_tags(plan or "")
    if not plan or len(plan) < 30:
        logger.info("cascade: arbiter plan failed, enriched fallback")
        return _reasoning_think(enriched_prompt, max_tokens=max_tokens, system=_THINK_SYSTEM)

    # Source injection from arbiter plan: camelCase names validated against registry.
    _plan_modules_raw = re.findall(r'\b[a-z]+(?:[A-Z][a-z]+)+\b', plan)
    _registry_set = set(_registry_mods)
    _plan_modules = [m for m in _plan_modules_raw if m in _registry_set]
    if len(_plan_modules) < len(_plan_modules_raw):
        _dropped = set(_plan_modules_raw) - _registry_set
        logger.info(f"cascade: dropped {len(_dropped)} hallucinated modules from plan: {_dropped}")
    _plan_source_block = ""
    for _pm in list(dict.fromkeys(_plan_modules))[:3]:
        _src = _read_module_source(_pm, max_chars=1200)
        if _src:
            _plan_source_block += f"\n[{_pm} source]\n{_src}\n"
            if len(_plan_source_block) > 2000:
                break

    # Merge pre-discovered + plan-derived sources (pre-discovered takes priority)
    _source_block = (_pre_source_block + "\n" + _plan_source_block).strip()
    if not _source_block and _registry_mods:
        # Last resort: inject first matching module from registry
        _src = _read_module_source(_registry_mods[0], max_chars=1500)
        if _src:
            _source_block = f"[{_registry_mods[0]} source]\n{_src}"
    logger.info(
        f"cascade: sources={len(_source_block)}c registry={len(_registry_mods)} "
        f"plan_mods={len(_plan_modules)}"
    )

    # Stage 2: Coder kickstart -- structured fact extraction grounded in source
    _coder_prefix = f"SOURCE CODE:\n{_source_block}\n\n" if _source_block else ""
    coder_out = _local_think(
        f"{_coder_prefix}"
        f"Execute this analysis plan:\n\n{plan}\n\nQUESTION: {prompt[:300]}\n\n"
        "For each step extract: FILE (exact path from source code above), FUNCTION, SIGNALS, CONNECTS.\n"
        "Only use paths and names from SOURCE CODE above. Exhaustive facts. No analysis.",
        max_tokens=2500, model=_LOCAL_MODEL, system=_THINK_SYSTEM,
        temperature=0.1, priority="interactive",
    )
    if not coder_out or len(coder_out) < 40:
        logger.info("cascade: local coder failed, cloud coder-profile fallback")
        return _reasoning_think(
            f"Plan:\n{plan}\n\n{enriched_prompt}",
            max_tokens=max_tokens, system=_THINK_SYSTEM, profile="coder",
        )

    _synthesis_prompt = (
        f"Question: {prompt[:300]}\n\n"
        f"VERIFIED FACTS (trust these paths/names):\n{coder_out}\n\n"
        "Synthesize: module interactions, architectural implications, recommendations.\n"
        "Use ONLY names from verified facts. Max 600 words."
    )
    result = _reasoning_think(_synthesis_prompt, max_tokens=max_tokens,
                              system=_THINK_SYSTEM, temperature=0.2)
    if result:
        logger.info(f"cascade: arbiter({len(plan)}c)->coder({len(coder_out)}c)->reasoning({len(result)}c)")
        result += f"\n\n*cascade: arbiter({len(plan)}c)->coder({len(coder_out)}c)->reasoning({len(result)}c)*"
    return result


def dual_gpu_consensus(prompt: str, max_tokens: int = 4096) -> str | None:
    """Fire both GPUs in parallel on the same prompt. Arbiter picks the best.

    Coder and reasoner analyze independently -- if they agree, high confidence.
    If they disagree, the disagreement itself is a valuable finding.
    """
    from .synthesis_config import _THINK_SYSTEM

    results = [None, None]

    def _g0():
        results[0] = _local_think(prompt, max_tokens=max_tokens, model=_LOCAL_MODEL,
                                   system=_THINK_SYSTEM, temperature=0.15, priority="parallel")

    def _g1():
        results[1] = _reasoning_think(prompt, max_tokens=max_tokens,
                                      system=_THINK_SYSTEM, temperature=0.2)

    t0 = _threading.Thread(target=_g0, daemon=True)
    t1 = _threading.Thread(target=_g1, daemon=True)
    t0.start(); t1.start()
    t0.join(); t1.join()

    g0, g1 = results[0], results[1]
    if not g0 and not g1:
        return None
    if not g0:
        return g1
    if not g1:
        return g0

    # Both succeeded -- arbiter picks winner
    pick = _local_think_with_system(
        f"Two analyses of: {prompt[:150]}\n\n"
        f"A (coder):\n{g0[:600]}\n\nB (reasoner):\n{g1[:600]}\n\n"
        "Which is better? Respond: A or B, then one sentence why.",
        "Pick A or B. Default B if equal.", 80, _ARBITER_MODEL,
    )
    picked_a = False
    if pick:
        pick = strip_thinking_tags(pick)
        tokens = pick.strip().split()
        if tokens and tokens[0].upper().startswith("A"):
            picked_a = True

    if picked_a:
        logger.info(f"dual_gpu: coder picked ({len(g0)}c vs {len(g1)}c)")
        return g0
    logger.info(f"dual_gpu: reasoner picked ({len(g1)}c vs {len(g0)}c)")
    return g1


def _quality_gate(output: str, prompt: str) -> tuple[str, int, int]:
    """Deterministic quality gate: verify camelCase module names in output exist.

    Zero latency -- no model call. Extracts camelCase module references, verifies
    each resolves via _read_module_source. Skips modules embedded in file paths
    (directory names cause false phantoms). Flags if >50% are unresolvable.

    Returns (output, phantom_count, verified_count) for Layer 19 observability.
    """
    if not output or len(output) < 80:
        return output, 0, 0

    paths = set(re.findall(r'(?:src|tools)/[\w/]+\.(?:js|py|json|ts)', output))
    path_basenames = {p.rsplit('/', 1)[-1].rsplit('.', 1)[0] for p in paths}
    modules = re.findall(r'\b[a-z]+(?:[A-Z][a-z]+)+\b', output)
    unique = []
    for m in dict.fromkeys(modules):
        if m in ("camelCase", "toString", "valueOf", "hasOwnProperty"):
            continue
        if m in path_basenames:
            continue
        unique.append(m)
    if not unique:
        return output, 0, 0

    phantom = 0
    for m in unique[:5]:
        if not _read_module_source(m, max_chars=100):
            phantom += 1
    verified = len(unique[:5]) - phantom

    if len(unique) > 0 and phantom / len(unique[:5]) > 0.5:
        logger.info(f"quality_gate: {phantom}/{len(unique[:5])} module refs unresolvable")
        return f"[unverified -- {phantom} refs unresolved] {output}", phantom, verified
    return output, phantom, verified


