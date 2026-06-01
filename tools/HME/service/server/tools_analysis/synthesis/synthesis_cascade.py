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
from paths import hme_metric
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


def _load_patterns_cache() -> dict | None:
    """L25: load synthesis patterns file for adaptive routing. Cached for 5min."""
    global _patterns_cache, _patterns_cache_ts
    import time as _t
    now = _t.time()
    if _patterns_cache is not None and now - _patterns_cache_ts < _PATTERNS_CACHE_TTL:
        return _patterns_cache
    try:
        path = hme_metric("hme-synthesis-patterns.json")
        with open(path) as f:
            _patterns_cache = json.load(f)
        _patterns_cache_ts = now
        return _patterns_cache
    except (OSError, json.JSONDecodeError, ValueError, TypeError):
        return None


def _assess_complexity(prompt: str) -> dict:
    """Score prompt complexity 1-3 via two-tier heuristic + L25 adaptive evidence.

    Deep signals (architecture, coupling, feedback) score 1.0 each.
    Moderate signals (detect, trace, flow) score 0.5 each.
    Mentioning specific modules (camelCase) adds 0.5 bonus.

    L25 Adaptive Routing: consults hme-synthesis-patterns.json for historical
    per-strategy phantom rates. If direct strategy has phantom_rate > 0.4 for
    similar prompts, boosts score toward cascade. If cascade has high phantom
    rate, doesn't penalize -- cascade is already the safest route.
    Score >= 3.0 -> cascade, >= 1.5 -> enriched, else direct.
    """
    words_lower = prompt.lower()

    if any(s in words_lower for s in _SIMPLE_SIGNALS):
        return {"complexity": 1, "strategy": "direct", "reasoning": "simple"}

    deep = sum(1 for s in _DEEP_SIGNALS if s in words_lower)
    mod = sum(1 for s in _MOD_SIGNALS if s in words_lower)
    modules = re.findall(r'\b[a-z]+(?:[A-Z][a-z]+)+\b', prompt)
    score = deep + mod * 0.5 + (0.5 if modules else 0)

    # L25: adaptive adjustment from historical synthesis patterns
    l25_adj = 0.0
    patterns = _load_patterns_cache()
    _tc = patterns.get("total_calls_analyzed") if patterns else None
    if _tc is not None and _tc >= 20:
        strat_phantoms = patterns.get("strategy_phantom_rates", {})
        direct_pr = strat_phantoms.get("direct", 0.0)
        enriched_pr = strat_phantoms.get("enriched", 0.0)
        # If direct/enriched routes have high phantom rates historically,
        # nudge toward cascade for complex-ish prompts
        if direct_pr > 0.4 and score >= 0.5:
            l25_adj += 0.5
        if enriched_pr > 0.4 and score >= 1.0:
            l25_adj += 0.5
        # Check if prompt contains known phantom-trigger words
        trigger_words = {w for w, _ in patterns.get("top_phantom_trigger_words", [])}
        prompt_words = set(words_lower.split())
        trigger_hits = len(prompt_words & trigger_words)
        if trigger_hits >= 2:
            l25_adj += 0.5 * min(trigger_hits, 3)
    score += l25_adj

    reasoning = f"score={score:.1f}"
    if l25_adj > 0:
        reasoning += f" (L25:+{l25_adj:.1f})"

    if score < 0.5 and len(prompt) < 150:
        return {"complexity": 1, "strategy": "direct", "reasoning": "short, no signals"}
    if score >= 3.0:
        return {"complexity": 3, "strategy": "cascade", "reasoning": reasoning}
    if score >= 1.5 or len(prompt) > 300:
        return {"complexity": 2, "strategy": "enriched", "reasoning": reasoning}
    return {"complexity": 1, "strategy": "direct", "reasoning": reasoning}


def _camel_acronym(name: str) -> str:
    """Compute first-letter acronym of a camelCase name.
    coordinationIndependenceManager -> 'cim'
    """
    if not name:
        return ""
    parts = re.sub(r'([A-Z])', r' \1', name).split()
    return ''.join(p[0] for p in parts).lower() if parts else name[0].lower()


def _fuzzy_find_modules(prompt: str, max_results: int = 3) -> list[str]:
    """Fuzzy module discovery: find src/ JS modules whose names overlap with prompt terms.

    Handles non-camelCase prompts (e.g. "CIM", "coupling", "feedback loop") via:
    - Substring matching of significant words against lowercased module names
    - camelCase component word decomposition
    - Acronym matching: all-caps terms (CIM) matched against module first-letter acronyms
    Returns module basenames (without .js), highest-score first.
    """
    import glob as _g
    significant = {w for w in re.split(r'\W+', prompt.lower()) if len(w) > 3}
    # All-caps terms (acronyms like CIM, KB) matched against module acronyms
    acronyms = {w.lower() for w in re.split(r'\W+', prompt) if len(w) >= 2 and w.isupper()}
    significant |= acronyms
    if not significant:
        return []
    scored: list[tuple[int, str]] = []
    root = getattr(ctx, "PROJECT_ROOT", ENV.optional("POLYCHRON_ROOT", ""))
    for f in _g.glob(os.path.join(root, "src", "**", "*.js"), recursive=True):
        m = os.path.basename(f).replace('.js', '')
        m_lower = m.lower()
        m_words = set(re.sub(r'([A-Z])', r' \1', m).lower().split())
        m_acronym = _camel_acronym(m)
        # Acronym match scores 2 (intentional abbreviation) vs 1 (substring hit)
        hits = (
            sum(1 for s in significant if s in m_lower or any(s in w for w in m_words))
            + sum(2 for s in significant if s == m_acronym)
        )
        if hits > 0:
            scored.append((hits, m))
    scored.sort(key=lambda x: -x[0])
    return [m for _, m in scored[:max_results]]


def _inject_context(prompt: str) -> str:
    """Enrich prompt with source code grounding + operational health.

    Session narrative is NOT added here -- _local_think handles that separately.
    Extracts module names from prompt (camelCase-first), falls back to fuzzy
    search when prompt uses plain English terms for known modules.
    """
    modules = re.findall(r'\b[a-z]+(?:[A-Z][a-z]+)+\b', prompt)
    path_bases = re.findall(r'(?:src|tools)/\S+/([a-zA-Z]+)\.\w+', prompt)
    candidates = list(dict.fromkeys(modules + path_bases))

    parts = []
    for mod in candidates[:2]:
        src = _read_module_source(mod, max_chars=2000)
        if src:
            parts.append(f"[Source: {mod}]\n{src}")
            if len("\n".join(parts)) > 3500:
                break

    # If camelCase/path candidates yielded no source (e.g. "crossLayer" is a directory),
    # fuzzy-search src/ by prompt term overlap to find real modules.
    if not parts:
        for mod in _fuzzy_find_modules(prompt, max_results=3):
            src = _read_module_source(mod, max_chars=2000)
            if src:
                parts.append(f"[Source: {mod}]\n{src}")
                if len("\n".join(parts)) > 3500:
                    break

    try:
        from server import operational_state
        ops = operational_state.snapshot()
        alerts = []
        _crashes = ops.get("shim_crashes_today")
        if _crashes is not None and _crashes > 0:
            alerts.append(f"shim_crashes={_crashes}")
        _recovery = ops.get("recovery_success_rate_ema")
        # 0.0 recovery rate is worse than "unknown" -- must trigger alert,
        if _recovery is not None and _recovery < 0.8:
            alerts.append(f"recovery={_recovery:.0%}")
        if alerts:
            parts.append(f"[Health: {', '.join(alerts)}]")
    except Exception as _err5:
        logger.debug(f"parts.append: {type(_err5).__name__}: {_err5}")

    # L26: morphogenetic pre-loading -- inject semantic field from intent + patterns
    try:
        from server import meta_observer
        intent = meta_observer.get_current_intent()
        if intent and intent.get("mode"):
            field_parts = []
            mode = intent["mode"]
            if mode == "debugging" and intent.get("hints"):
                field_parts.append(f"[Intent: debugging -- {', '.join(intent['hints'][:3])}]")
            elif mode == "design":
                field_parts.append("[Intent: architectural design -- prioritize boundary constraints]")
            elif mode == "stress_testing":
                field_parts.append("[Intent: stress testing -- be precise about enforcement gaps]")
            if field_parts:
                parts = field_parts + parts
    except Exception as _err6:
        logger.debug(f"field_parts + parts: {type(_err6).__name__}: {_err6}")

    # L25: surface historical phantom risk for this prompt type
    patterns = _load_patterns_cache()
    if patterns and patterns.get("strategy_phantom_rates"):
        high_phantom_strats = [
            f"{s}:{r:.0%}" for s, r in patterns["strategy_phantom_rates"].items() if r > 0.3
        ]
        if high_phantom_strats:
            parts.append(f"[Phantom risk: {', '.join(high_phantom_strats)}]")

    return "\n".join(parts) + "\n\n" + prompt if parts else prompt



# Re-exports -- cascade dispatch extracted.
from .synthesis_cascade_dispatch import (  # noqa: F401, E402
    _cascade_synthesis, dual_gpu_consensus, _quality_gate,
)

def synthesize(prompt: str, max_tokens: int = 8192, priority: str = "interactive",
               auto_context: bool = True, quality_check: bool = True) -> str | None:
    """Adaptive multi-stage synthesis -- highest-quality inference path in HME.

    1. Assesses complexity (arbiter scores 1-3)
    2. Injects source grounding + operational context
    3. Routes: direct (1) / enriched (2) / cascade (3)
    4. Quality-gates output via arbiter
    5. Auto-escalates strategy on failure (direct->enriched->cascade)
    """
    import time as _t
    from .synthesis_config import _THINK_SYSTEM
    t0 = _t.time()

    assessment = _assess_complexity(prompt)
    complexity = assessment["complexity"]
    strategy = assessment["strategy"]

    result = None
    _used_cascade = False
    if strategy == "cascade":
        enriched = _inject_context(prompt) if auto_context else prompt
        result = _cascade_synthesis(prompt, enriched, max_tokens)
        _used_cascade = True
    elif strategy == "enriched":
        enriched = _inject_context(prompt) if auto_context else prompt
        model = route_model(prompt)
        result = _local_think(enriched, max_tokens=max_tokens, model=model,
                             system=_THINK_SYSTEM, priority=priority)
    else:
        model = route_model(prompt)
        result = _local_think(prompt, max_tokens=min(max_tokens, 4096), model=model,
                             system=_THINK_SYSTEM, priority=priority)

    if not result and strategy != "cascade":
        enriched = _inject_context(prompt) if auto_context else prompt
        result = _reasoning_think(enriched, max_tokens=max_tokens,
                                  system=_THINK_SYSTEM, temperature=0.2)
    if not result and strategy != "cascade":
        enriched = _inject_context(prompt) if auto_context else prompt
        result = _cascade_synthesis(prompt, enriched, max_tokens)
        _used_cascade = True

    if not result:
        return None

    _escalated = _used_cascade and strategy != "cascade"
    _phantom_count, _verified_count = 0, 0
    if quality_check and _used_cascade:
        result, _phantom_count, _verified_count = _quality_gate(result, prompt)

    elapsed = _t.time() - t0
    logger.info(f"synthesize: {strategy}(c={complexity}) {len(result)}c {elapsed:.1f}s")

    # Layer 19: record routing decision + quality outcome for synthesis observability
    # Layer 34: thermodynamic efficiency tracking
    try:
        from server import operational_state as _ops
        _ops.record_synthesis_call(
            strategy=strategy,
            used_cascade=_used_cascade,
            escalated=_escalated,
            quality_gate_fired=quality_check and _used_cascade,
            phantom_count=_phantom_count,
            verified_count=_verified_count,
            elapsed_s=elapsed,
            prompt_head=prompt[:60],
        )
        _ops.record_thermodynamic(
            verified=_verified_count, phantom=_phantom_count,
            elapsed_s=elapsed, cache_hit=False,
        )
    except Exception as _err7:
        logger.debug(f"): {type(_err7).__name__}: {_err7}")

    from .synthesis_session import append_session_narrative
    append_session_narrative(
        "think", f"synthesize({strategy},c={complexity}): {prompt[:50]}->{len(result)}c"
    )

    return result
