"""HME warm KV context — persona construction, priming, and status for all three models.

Warm context = each model's specialized persona + full KB pre-tokenized into Ollama's KV
cache via the context= array. Avoids re-tokenizing the same persona text on every call.
KV cache spills to RAM (models ~21GB VRAM, <600 MiB free per GPU) — correct behavior.
"""
import os
import logging
import threading as _threading

from server import context as ctx

logger = logging.getLogger("HME")

# Shared warm context state — imported by synthesis_ollama for context= injection
_warm_ctx: dict[str, list] = {}
_warm_ctx_kb_ver: dict[str, int] = {}
_warm_ctx_ts: dict[str, float] = {}

_lazy_prime_attempted = False


def _load_src_files_for_warm(patterns: list[str], token_budget: int) -> str:
    """Load src/ file contents up to a token budget for warm context expansion.

    Files loaded smallest-first to maximize file count within budget.
    token_budget: approximate token ceiling (1 token ≈ 3 chars for mixed code+text).
    """
    import glob as _glob
    char_budget = token_budget * 3  # conservative: mixed code+text averages ~3 chars/token
    candidates = []
    for pattern in patterns:
        for fpath in _glob.glob(os.path.join(ctx.PROJECT_ROOT, pattern), recursive=True):
            if "index.js" in os.path.basename(fpath) or "__pycache__" in fpath:
                continue
            try:
                candidates.append((os.path.getsize(fpath), fpath))
            except Exception:
                pass
    candidates.sort()
    parts = []
    used = 0
    for size, fpath in candidates:
        if used >= char_budget:
            break
        try:
            content = open(fpath, encoding="utf-8", errors="ignore").read()
            rel = fpath.replace(ctx.PROJECT_ROOT + "/", "")
            entry = f"\n// --- {rel} ---\n{content}\n"
            if used + len(entry) > char_budget:
                entry = entry[:char_budget - used]
            parts.append(entry)
            used += len(entry)
        except Exception:
            pass
    return "".join(parts)


def _gpu_persona(model: str) -> str:
    """Build model-specialized warm persona. GPU0=extractor, GPU1=reasoner, arbiter=hallucination guard."""
    import glob as _glob
    # Import model constants from synthesis_ollama to avoid circular imports
    from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL, _NUM_CTX_30B, _NUM_CTX_4B
    from .synthesis_config import _THINK_SYSTEM

    full_kb = ""
    try:
        all_kb = ctx.project_engine.list_knowledge_full() or []
        full_kb = "\n".join(
            f"  [{k.get('category','')}] {k.get('title','')}: {k.get('content','')[:300]}"
            for k in all_kb
        )
    except Exception:
        pass

    _modules = []
    try:
        _cl_files = _glob.glob(
            os.path.join(ctx.PROJECT_ROOT, "src", "crossLayer", "**", "*.js"), recursive=True
        )
        _modules = sorted(set(
            os.path.basename(f).replace(".js", "") for f in _cl_files
            if not os.path.basename(f).startswith("index")
        ))
    except Exception:
        pass
    modules_str = ", ".join(_modules) if _modules else "(unavailable)"

    if model == _LOCAL_MODEL:
        base = (
            "You are the code extractor for Polychron, a self-evolving alien generative music "
            "system with 19 hypermeta controllers and 26 cross-layer modules. "
            "Your role: extract FACTS. File paths (src/crossLayer/...), signal fields, "
            "correlation values, coupling dimensions, bridge status (VIRGIN/PARTIAL/SATURATED). "
            "Antagonism bridges couple BOTH modules of a negatively-correlated pair to the "
            "SAME signal with OPPOSING effects. Never reason or opine — output raw data only.\n"
            "Real crossLayer modules: " + modules_str + ".\n\n"
            "Full KB (ground truth, " + str(len(full_kb.split('\n'))) + " entries):\n" + full_kb
        )
        _base_tokens = len(base) // 3
        _src_budget = max(1000, _NUM_CTX_30B - _base_tokens - 1024)
        src = _load_src_files_for_warm([
            "src/crossLayer/**/*.js",
            "src/conductor/**/*.js",
            "src/fx/**/*.js",
        ], _src_budget)
        return base + "\n\n// ===== SOURCE FILES =====\n" + src

    if model == _ARBITER_MODEL:
        _signal_fields = []
        try:
            import re as _re
            _l0_files = _glob.glob(
                os.path.join(ctx.PROJECT_ROOT, "src", "conductor", "signal", "**", "*.js"),
                recursive=True
            )
            for _f in _l0_files[:10]:
                try:
                    _txt = open(_f).read(4000)
                    _signal_fields += _re.findall(r"'([a-z][a-zA-Z]+)'", _txt)[:5]
                except Exception:
                    pass
            _signal_fields = sorted(set(_signal_fields))[:40]
        except Exception:
            pass
        if not _signal_fields:
            _signal_fields = ["contourShape", "counterpoint", "thematicDensity",
                              "tessituraPressure", "intervalFreshness", "density",
                              "complexity", "biasStrength", "densitySurprise",
                              "hotspots", "complexityEma"]
        # Arbiter only needs module/field lists for hallucination detection — not full KB
        arb_base = (
            "You are the arbiter for Polychron, a self-evolving alien generative music system. "
            "Your role: compare two independent code analyses and detect contradictions, "
            "hallucinated module names, and overlooked facts. "
            "Real crossLayer modules: " + modules_str + ". "
            "Known signal fields: " + ", ".join(_signal_fields) + ". "
            "If an analysis cites a module or field NOT in these lists, flag it."
        )
        _base_tokens = len(arb_base) // 3
        _src_budget = max(500, _NUM_CTX_4B - _base_tokens - 512)
        src = _load_src_files_for_warm([
            "scripts/pipeline/*.js",
            "src/conductor/melodic/*.js",
            "src/crossLayer/structure/**/*.js",
        ], _src_budget)
        return arb_base + "\n\n// ===== PIPELINE SCRIPTS =====\n" + src

    # Reasoner persona: full KB + module list
    rsn_base = (
        _THINK_SYSTEM + "\n\n"
        "Synthesize facts into actionable insights about musical effects, coupling patterns, "
        "and evolution strategy. Cite specific file paths and signal fields. Never invent "
        "module names not in this list: " + modules_str + ".\n\n"
        "Full KB (ground truth, " + str(len(full_kb.split('\n'))) + " entries):\n" + full_kb
    )
    _base_tokens = len(rsn_base) // 3
    _src_budget = max(1000, _NUM_CTX_30B - _base_tokens - 1024)
    src = _load_src_files_for_warm([
        "src/conductor/signal/**/*.js",
        "src/crossLayer/**/*.js",
        "src/composers/**/*.js",
    ], _src_budget)
    return rsn_base + "\n\n// ===== SOURCE FILES =====\n" + src


def _prime_warm_context(model: str) -> bool:
    """Prime warm KV context for a model. Background priority, skips if KB unchanged."""
    from .synthesis_ollama import _local_think, _THINK_SYSTEM
    kb_ver = getattr(ctx, "_kb_version", 0)
    if _warm_ctx_kb_ver.get(model) == kb_ver and model in _warm_ctx:
        logger.debug(f"warm ctx already fresh: {model} (kb_ver={kb_ver})")
        return True
    logger.info(f"warm ctx priming: {model} (kb_ver={kb_ver}) — building persona...")
    try:
        persona = _gpu_persona(model)
    except Exception as e:
        logger.warning(f"warm ctx priming FAILED: {model} (_gpu_persona crashed: {type(e).__name__}: {e})")
        return False
    logger.info(f"warm ctx priming: {model} — persona built ({len(persona)} chars), sending Ollama request...")
    result = _local_think(
        persona + "\n\nI understand this codebase context. Ready.",
        max_tokens=8, model=model, priority="background",
        temperature=0.0, return_context=True,
    )
    ctx_array = result[1] if isinstance(result, tuple) else None
    if ctx_array:
        import time as _t
        _warm_ctx[model] = ctx_array
        _warm_ctx_kb_ver[model] = kb_ver
        _warm_ctx_ts[model] = _t.time()
        logger.info(f"warm ctx PRIMED: {model} ({len(ctx_array)} ctx tokens, kb_ver={kb_ver})")
        return True
    logger.warning(
        f"warm ctx priming FAILED: {model} — result type={type(result).__name__}, "
        f"is_tuple={isinstance(result, tuple)}, "
        f"ctx_array_len={len(ctx_array) if ctx_array else 'None'}"
    )
    return False


def _prime_all_gpus() -> str:
    """Prime all three models in parallel threads. Returns status summary."""
    from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
    import time as _t
    results = [False, False, False]
    def _do0(): results[0] = _prime_warm_context(_LOCAL_MODEL)
    def _do1(): results[1] = _prime_warm_context(_REASONING_MODEL)
    def _do2(): results[2] = _prime_warm_context(_ARBITER_MODEL)
    t0 = _t.time()
    threads = [
        _threading.Thread(target=_do0, daemon=True),
        _threading.Thread(target=_do1, daemon=True),
        _threading.Thread(target=_do2, daemon=True),
    ]
    for t in threads:
        t.start()
    # 600s: Ollama serializes 3 large persona prompts — worst case ~10-12 min total
    for t in threads:
        t.join(timeout=600)
    for t in threads:
        if t.is_alive():
            logger.warning(f"_prime_all_gpus: thread {t.name} still running after 600s — Ollama may be overloaded")
    elapsed = _t.time() - t0
    parts = [f"Warm context priming ({elapsed:.1f}s):"]
    for model, ok in [(_LOCAL_MODEL, results[0]), (_REASONING_MODEL, results[1]),
                      (_ARBITER_MODEL, results[2])]:
        ctx_len = len(_warm_ctx.get(model, []))
        parts.append(f"  {model}: {'PRIMED' if ok else 'FAILED'}" +
                     (f" ({ctx_len} ctx tokens)" if ok else ""))
    return "\n".join(parts)


def warm_context_status() -> dict:
    """Health dict of warm contexts for selftest."""
    from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
    from .synthesis_session import session_state_counts
    import time as _t
    now = _t.time()
    status = {}
    for model in [_LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL]:
        if model in _warm_ctx:
            status[model] = {
                "primed": True, "tokens": len(_warm_ctx[model]),
                "age_s": round(now - _warm_ctx_ts.get(model, 0), 1),
                "kb_fresh": _warm_ctx_kb_ver.get(model) == getattr(ctx, "_kb_version", 0),
            }
        else:
            status[model] = {"primed": False}
    status.update(session_state_counts())
    return status


def ensure_warm(model: str):
    """Lazy warm priming — fires background thread on first synthesis call if not primed."""
    global _lazy_prime_attempted
    if model in _warm_ctx:
        return
    if _lazy_prime_attempted:
        return
    _lazy_prime_attempted = True
    def _bg():
        global _lazy_prime_attempted
        from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
        try:
            ok0 = _prime_warm_context(_LOCAL_MODEL)
            ok1 = _prime_warm_context(_REASONING_MODEL)
            ok2 = _prime_warm_context(_ARBITER_MODEL)
            if not any([ok0, ok1, ok2]):
                _lazy_prime_attempted = False
                logger.info("lazy warm priming: all failed, will retry on next synthesis call")
        except Exception as _e:
            _lazy_prime_attempted = False
            logger.warning(f"lazy warm priming background thread failed: {type(_e).__name__}: {_e}")
    _threading.Thread(target=_bg, daemon=True).start()
    logger.info("lazy warm context priming started (background)")
