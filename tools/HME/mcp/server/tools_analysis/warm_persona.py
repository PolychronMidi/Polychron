"""Model-specialized persona construction for HME warm KV context.

Each GPU model gets a different persona: GPU0=code extractor (facts only),
GPU1=reasoner (synthesis + strategy), arbiter=hallucination guard.
Personas are hard-capped at _MAX_PERSONA_CHARS to prevent KV cache overflow
on the M40s (<600 MiB headroom per GPU).
"""
import os
import logging

from server import context as ctx

logger = logging.getLogger("HME")

# Hard cap on persona size (chars). 12K chars ≈ 4K tokens — keeps prompt eval under
# ~30s on M40, so interactive cancellation (via socket timeout in _cancellable_urlopen)
# limits worst-case Ollama queue wait to ~30s. Larger personas (50K) caused ~120s prompt
# eval during which Ollama ignores client disconnect, blocking interactive requests.
_MAX_PERSONA_CHARS = 12_000


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
    from .synthesis_ollama import _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL
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
        _src_char_budget = max(1000, _MAX_PERSONA_CHARS - len(base) - 100)
        _src_token_budget = _src_char_budget // 3
        src = _load_src_files_for_warm([
            "src/crossLayer/**/*.js",
            "src/conductor/**/*.js",
            "src/fx/**/*.js",
        ], _src_token_budget)
        return (base + "\n\n// ===== SOURCE FILES =====\n" + src)[:_MAX_PERSONA_CHARS]

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
        arb_base = (
            "You are the arbiter for Polychron, a self-evolving alien generative music system. "
            "Your role: compare two independent code analyses and detect contradictions, "
            "hallucinated module names, and overlooked facts. "
            "Real crossLayer modules: " + modules_str + ". "
            "Known signal fields: " + ", ".join(_signal_fields) + ". "
            "If an analysis cites a module or field NOT in these lists, flag it."
        )
        _arbiter_cap = min(_MAX_PERSONA_CHARS, 4_000)
        _src_char_budget = max(500, _arbiter_cap - len(arb_base) - 100)
        _src_token_budget = _src_char_budget // 3
        src = _load_src_files_for_warm([
            "scripts/pipeline/*.js",
            "src/conductor/melodic/*.js",
            "src/crossLayer/structure/**/*.js",
        ], _src_token_budget)
        return (arb_base + "\n\n// ===== PIPELINE SCRIPTS =====\n" + src)[:_arbiter_cap]

    # Reasoner persona: full KB + module list
    rsn_base = (
        _THINK_SYSTEM + "\n\n"
        "Synthesize facts into actionable insights about musical effects, coupling patterns, "
        "and evolution strategy. Cite specific file paths and signal fields. Never invent "
        "module names not in this list: " + modules_str + ".\n\n"
        "Full KB (ground truth, " + str(len(full_kb.split('\n'))) + " entries):\n" + full_kb
    )
    _src_char_budget = max(1000, _MAX_PERSONA_CHARS - len(rsn_base) - 100)
    _src_token_budget = _src_char_budget // 3
    src = _load_src_files_for_warm([
        "src/conductor/signal/**/*.js",
        "src/crossLayer/**/*.js",
        "src/composers/**/*.js",
    ], _src_token_budget)
    return (rsn_base + "\n\n// ===== SOURCE FILES =====\n" + src)[:_MAX_PERSONA_CHARS]
