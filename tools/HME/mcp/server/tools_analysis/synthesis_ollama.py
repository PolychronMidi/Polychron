"""HME Ollama synthesis layer — local model inference, two-stage and parallel synthesis."""
import json
import os
import re
import logging
import threading as _threading

from server import context as ctx
from .synthesis_config import _THINK_SYSTEM

logger = logging.getLogger("HME")


_LOCAL_MODEL = os.environ.get("HME_LOCAL_MODEL", "qwen3-coder:30b")
# Reasoning model: Qwen3-30B-A3B (MoE, 3B active params, hybrid thinking mode).
# Beats QwQ-32B and DeepSeek-R1 on reasoning benchmarks at lower compute.
# ~18.6GB Q4 — fits on one M40. qwen2.5-coder:14b (~9GB) on the other. Both loaded.
_REASONING_MODEL = os.environ.get("HME_REASONING_MODEL", "qwen3:30b-a3b")
# Arbiter model: Qwen3 4B (~2.5GB Q4) — same architecture family as GPU models.
# Hybrid thinking mode: arbiter THINKS before judging — reasoning is essential for catching
# contradictions between complex code analyses. Fits alongside 18.6GB models (~4-5GB free
# per 24GB GPU). Runs during GPU idle time (between Stage 1 and Stage 2) — zero contention.
# Ollama auto-schedules GPU layers; falls back to CPU/RAM (64GB) when GPUs are busy.
# Pull with: ollama pull qwen3:4b
_ARBITER_MODEL = os.environ.get("HME_ARBITER_MODEL", "qwen3:4b")

_LOCAL_URL = os.environ.get("HME_LOCAL_URL", "http://localhost:11434/api/generate")
# Chat endpoint: Ollama /api/chat accepts messages=[{role,content}] (OpenAI-compatible).
# Prefer over /api/generate for multi-turn synthesis — model sees prior outputs as
# "assistant turns it already said", producing more coherent continuation than feeding
# them back as raw text. This is the equivalent of Claude's conversation memory.
_LOCAL_CHAT_URL = _LOCAL_URL.replace("/api/generate", "/api/chat")


# ── Ollama priority queue ──────────────────────────────────────────────────
# Ollama processes requests sequentially. Background pre-warm can queue 30+ calls.
# Interactive calls (think, before_editing on-demand) must pop to the top.
#
# Design: a threading.Event that background callers check before each Ollama call.
# When an interactive call arrives, it sets the event, background callers yield
# (sleep + re-check), and the interactive call proceeds immediately.
_ollama_interactive = _threading.Event()  # set = interactive call waiting
_ollama_lock = _threading.Lock()          # serializes actual Ollama calls (fallback)
# Per-GPU locks for multi-stage ping-pong: coder and reasoner can run simultaneously
_gpu0_lock = _threading.Lock()  # qwen3-coder:30b (extraction)
_gpu1_lock = _threading.Lock()  # qwen3:30b-a3b (reasoning)


# ── Warm KV context ───────────────────────────────────────────────────────
# Persistent pre-tokenized contexts per GPU model. Each model gets a specialized persona:
#   GPU0 (_LOCAL_MODEL): extraction-focused — file paths, signals, facts
#   GPU1 (_REASONING_MODEL): reasoning-focused — musical effects, evolution strategy
# Primed lazily on first tool call and re-primed when KB version changes.
# Benefits: ~1000 tokens of system+KB context pre-processed in KV cache, eliminating
# re-tokenization on every synthesis call. The 6GB VRAM headroom per 24GB GPU
# easily holds the KV cache (~24KB/token × ~1000 tokens = ~24MB).
_warm_ctx: dict[str, list] = {}          # model → Ollama context array
_warm_ctx_kb_ver: dict[str, int] = {}    # model → kb_version when primed
_warm_ctx_ts: dict[str, float] = {}      # model → epoch timestamp of last priming

# ── Think continuation ────────────────────────────────────────────────────
# Cross-call memory for the think tool. Stores the last 3 think Q&A pairs as text
# and injects them as conversation history in subsequent think calls. This gives
# the think tool continuous session memory without growing the KV cache unboundedly.
_think_history: list[dict] = []           # [{about, answer}] sliding window
_THINK_HISTORY_MAX = 3                    # keep last N exchanges


def _ollama_background_yield():
    """Called by background tasks before each Ollama call. If an interactive call
    is waiting, yields by sleeping until it clears."""
    while _ollama_interactive.is_set():
        import time as _t
        _t.sleep(0.5)


def _gpu_persona(model: str) -> str:
    """GPU-specialized persona for warm context priming.
    GPU0 (extractor): structured code facts — paths, signals, correlations.
    GPU1 (reasoner): musical effects, evolution strategy, coupling analysis."""
    recent_kb = ""
    try:
        all_kb = ctx.project_engine.list_knowledge_full() or []
        recent_kb = "\n".join(
            f"  [{k.get('category','')}] {k.get('title','')}: {k.get('content','')[:120]}"
            for k in all_kb[-8:]
        )
    except Exception:
        pass
    if model == _LOCAL_MODEL:
        return (
            "You are the code extractor for Polychron, a self-evolving alien generative music "
            "system with 19 hypermeta controllers and 26 cross-layer modules. "
            "Your role: extract FACTS. File paths (src/crossLayer/...), signal fields, "
            "correlation values, coupling dimensions, bridge status (VIRGIN/PARTIAL/SATURATED). "
            "Antagonism bridges couple BOTH modules of a negatively-correlated pair to the "
            "SAME signal with OPPOSING effects. Never reason or opine — output raw data only.\n\n"
            "Recent KB (ground truth):\n" + recent_kb
        )
    return (
        _THINK_SYSTEM + "\n\n"
        "Synthesize facts into actionable insights about musical effects, coupling patterns, "
        "and evolution strategy. Cite specific file paths and signal fields. Never invent "
        "module names not in the provided context.\n\n"
        "Recent KB (ground truth):\n" + recent_kb
    )


def _prime_warm_context(model: str) -> bool:
    """Prime warm KV context for a specific model.
    Embeds GPU-specialized persona + recent KB into the model's KV cache.
    Background priority (yields to interactive). Skips if KB unchanged."""
    kb_ver = getattr(ctx, "_kb_version", 0)
    if _warm_ctx_kb_ver.get(model) == kb_ver and model in _warm_ctx:
        return True
    persona = _gpu_persona(model)
    # Embed persona in prompt (not system=) so KV cache contains it.
    # Subsequent calls pass context= without system=, avoiding double-processing.
    result = _local_think(
        persona + "\n\nI understand this codebase context. Ready.",
        max_tokens=8, model=model, priority="background",
        temperature=0.0, return_context=True,
    )
    if isinstance(result, tuple) and result[1]:
        import time as _t
        _warm_ctx[model] = result[1]
        _warm_ctx_kb_ver[model] = kb_ver
        _warm_ctx_ts[model] = _t.time()
        logger.info(f"warm ctx primed: {model} ({len(result[1])} ctx tokens, kb_ver={kb_ver})")
        return True
    return False


def _prime_all_gpus() -> str:
    """Prime both GPUs in parallel threads. Returns status summary."""
    import time as _t
    results = [False, False]
    def _do0():
        results[0] = _prime_warm_context(_LOCAL_MODEL)
    def _do1():
        results[1] = _prime_warm_context(_REASONING_MODEL)
    t0 = _t.time()
    th0 = _threading.Thread(target=_do0, daemon=True)
    th1 = _threading.Thread(target=_do1, daemon=True)
    th0.start(); th1.start()
    th0.join(timeout=120); th1.join(timeout=120)
    elapsed = _t.time() - t0
    parts = [f"Warm context priming ({elapsed:.1f}s):"]
    for model, ok in [(_LOCAL_MODEL, results[0]), (_REASONING_MODEL, results[1])]:
        ctx_len = len(_warm_ctx.get(model, []))
        parts.append(f"  {model}: {'PRIMED' if ok else 'FAILED'}" +
                     (f" ({ctx_len} ctx tokens)" if ok else ""))
    return "\n".join(parts)


def warm_context_status() -> dict:
    """Health dict of warm contexts for selftest."""
    import time as _t
    now = _t.time()
    status = {}
    for model in [_LOCAL_MODEL, _REASONING_MODEL]:
        if model in _warm_ctx:
            status[model] = {
                "primed": True, "tokens": len(_warm_ctx[model]),
                "age_s": round(now - _warm_ctx_ts.get(model, 0), 1),
                "kb_fresh": _warm_ctx_kb_ver.get(model) == getattr(ctx, "_kb_version", 0),
            }
        else:
            status[model] = {"primed": False}
    status["arbiter"] = _ARBITER_MODEL
    status["think_history"] = len(_think_history)
    return status


def _arbiter_check(gpu0_out: str | None, gpu1_out: str | None,
                   question: str) -> dict | None:
    """Triage arbiter: contrast GPU0/GPU1 outputs and classify conflict severity.

    Qwen3:4b thinks before judging — reasoning is essential for accurate conflict detection.
    Returns structured dict with severity level, or None if aligned / unavailable.

    Severity levels:
      ALIGNED  — no conflicts, proceed directly to Stage 2
      MINOR    — name mismatch or scope gap, inject as advisory note
      COMPLEX  — fundamental contradiction requiring escalation to reasoning model
                 for deep resolution before Stage 2 gets the brief

    The arbiter also catches GAPS: facts the extractor found that the reasoner ignored.
    """
    if not gpu0_out or not gpu1_out or len(gpu0_out) < 30 or len(gpu1_out) < 30:
        return None
    import urllib.request
    prompt = (
        "Two independent analyses of the same Polychron codebase question.\n\n"
        f"Question: {question[:200]}\n\n"
        f"EXTRACTOR (GPU0, structured facts):\n{gpu0_out[:800]}\n\n"
        f"REASONER (GPU1, analysis):\n{gpu1_out[:800]}\n\n"
        "Compare these analyses. Check for:\n"
        "1. Module names or signal fields in the reasoner NOT present in the extractor\n"
        "2. Contradicting claims about the same module (e.g. coupled vs uncoupled)\n"
        "3. Facts the extractor found that the reasoner completely ignored\n\n"
        "Classify and respond with EXACTLY one of these formats:\n"
        "ALIGNED — if no conflicts or gaps\n"
        "MINOR: <one sentence describing the mismatch>\n"
        "COMPLEX: <one sentence describing the fundamental contradiction>"
    )
    body = json.dumps({
        "model": _ARBITER_MODEL, "prompt": prompt, "stream": False,
        "options": {"temperature": 0.0, "num_predict": 600},
    }).encode()
    req = urllib.request.Request(
        _LOCAL_URL, data=body, headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            result = json.loads(resp.read())
            text = result.get("response", "").strip()
            if not text:
                text = result.get("thinking", "").strip()
            if "</think>" in text:
                text = text[text.rfind("</think>") + len("</think>"):].strip()
            text = re.sub(r'[^\x00-\x7F]+', '', text).strip()
            if not text:
                return None
            text_upper = text.upper()
            if "ALIGNED" in text_upper and "MINOR" not in text_upper and "COMPLEX" not in text_upper:
                logger.info("arbiter: ALIGNED")
                return None
            if "COMPLEX" in text_upper:
                logger.info(f"arbiter: COMPLEX conflict — {text[:200]}")
                return {"severity": "complex", "report": text}
            if "MINOR" in text_upper:
                logger.info(f"arbiter: MINOR conflict — {text[:200]}")
                return {"severity": "minor", "report": text}
            # Unstructured conflict — treat as minor
            logger.info(f"arbiter: unstructured conflict — {text[:200]}")
            return {"severity": "minor", "report": text}
    except Exception as e:
        logger.debug(f"arbiter unavailable: {e}")
        return None


def _resolve_complex_conflict(gpu0_out: str, gpu1_out: str,
                              arbiter_report: str, question: str) -> str | None:
    """Stage 1.75: Deep conflict resolution via the reasoning model (GPU1).

    When the arbiter detects a COMPLEX conflict — a fundamental contradiction between
    the extractor and reasoner — this function escalates to the full qwen3:30b-a3b
    reasoning model for authoritative resolution.

    The reasoning model sees: both analyses + the arbiter's conflict diagnosis.
    It produces a RESOLVED brief that reconciles the contradiction or decisively
    picks one side with justification. Stage 2 then works from this resolved brief
    instead of silently inheriting the contradiction.
    """
    resolve_prompt = (
        "The arbiter detected a COMPLEX conflict between two analyses of the "
        "Polychron codebase. You must RESOLVE this before the final answer.\n\n"
        f"Question: {question[:200]}\n\n"
        f"EXTRACTOR analysis:\n{gpu0_out[:600]}\n\n"
        f"REASONER analysis:\n{gpu1_out[:600]}\n\n"
        f"ARBITER CONFLICT:\n{arbiter_report[:400]}\n\n"
        "Resolve: which analysis is correct? If the reasoner cited modules or signals "
        "not in the extractor, those are likely hallucinated — trust the extractor's "
        "facts and discard the hallucinated elements. If there's a genuine disagreement "
        "about coupling state or signal effects, explain which side is supported by "
        "the evidence. Output a CORRECTED brief (max 300 words) that Stage 2 can "
        "safely use without inheriting the contradiction."
    )
    resolved = _local_think(resolve_prompt, max_tokens=1024, model=_REASONING_MODEL,
                            system=_THINK_SYSTEM, temperature=0.15)
    if resolved:
        logger.info(f"Stage 1.75: complex conflict resolved ({len(resolved)} chars)")
    return resolved


def store_think_history(about: str, answer: str):
    """Store a think Q&A pair for cross-call continuation."""
    _think_history.append({"about": about, "answer": answer[:300]})
    while len(_think_history) > _THINK_HISTORY_MAX:
        _think_history.pop(0)


def get_think_history_context() -> str:
    """Get formatted think history for injection into subsequent think calls."""
    if not _think_history:
        return ""
    lines = [f"  Q: {h['about'][:80]} → {h['answer'][:150]}" for h in _think_history]
    return "Previous think exchanges this session:\n" + "\n".join(lines) + "\n\n"


def _local_think(prompt: str, max_tokens: int = 8192, model: str | None = None,
                 priority: str = "interactive", system: str = "",
                 temperature: float = 0.3, context: list | None = None,
                 return_context: bool = False) -> str | tuple | None:
    """Call local Ollama model for synthesis tasks.

    Uses only stdlib -- no extra dependencies. Returns None if Ollama isn't running
    or the model isn't available, allowing callers to fall back gracefully.
    Pass model=_REASONING_MODEL for think/causal_trace/memory_dream tasks.
    system: optional system prompt for role-setting. When system==_THINK_SYSTEM and
      warm KV context is available, automatically uses the warm context and drops system=
      (already baked into the KV cache) — transparent speedup, no caller changes needed.
    temperature: 0.1 for deterministic extraction, 0.3 for balanced, 0.5 for creative.
    context: Ollama KV cache context array from a prior call (same model only).
      When provided, Ollama resumes from the cached model state instead of re-processing
      previous text — the closest analog to Claude's persistent context window.
    return_context: when True, returns (text, context_array) tuple instead of just text.
      Callers can pass the context_array to the next same-model call for KV cache reuse.
    """
    import urllib.request

    if priority == "background":
        _ollama_background_yield()
    elif priority == "interactive":
        _ollama_interactive.set()

    _effective_model = model or _LOCAL_MODEL

    # ── Auto-warm: use warm KV context when available ──
    # When system==_THINK_SYSTEM and no explicit context, swap in the warm KV cache.
    # The warm context already contains _THINK_SYSTEM + recent KB, pre-tokenized.
    # Drop system= to avoid double-processing (system is baked into context).
    if system == _THINK_SYSTEM and context is None:
        warm = _warm_ctx.get(_effective_model)
        kb_ver = getattr(ctx, "_kb_version", 0)
        if warm and _warm_ctx_kb_ver.get(_effective_model) == kb_ver:
            context = warm
            system = ""
            logger.debug(f"_local_think: warm ctx hit ({len(warm)} tokens, {_effective_model})")

    payload: dict = {
        "model": _effective_model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": temperature, "num_predict": max_tokens},
    }
    if system:
        payload["system"] = system
    if context:
        payload["context"] = context
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        _LOCAL_URL, data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        active_lock = (_gpu0_lock if (model or _LOCAL_MODEL) == _LOCAL_MODEL
                       else _gpu1_lock if (model or _LOCAL_MODEL) == _REASONING_MODEL
                       else _ollama_lock)
        with active_lock:
            resp_obj = urllib.request.urlopen(req, timeout=420)
        if priority == "interactive":
            _ollama_interactive.clear()
        with resp_obj as resp:
            result = json.loads(resp.read())
            text = result.get("response", "").strip()
            if "</think>" in text:
                text = text[text.rfind("</think>") + len("</think>"):].strip()
            elif "<think>" in text:
                text = text[text.find("<think>") + len("<think>"):].strip()
            if not text:
                thinking = result.get("thinking", "").strip()
                if thinking:
                    text = thinking
                else:
                    return None
            _hallucination_markers = [
                "in this hypothetical scenario", "as an AI", "I don't have access",
                "this document provides", "these documents provide",
                "as a language model", "i cannot determine",
            ]
            text_lower = text.lower()
            if any(m in text_lower for m in _hallucination_markers):
                logger.info(f"_local_think: suppressed hallucinated output ({len(text)} chars)")
                if priority == "interactive":
                    _ollama_interactive.clear()
                return None
            _reasoning_markers = [
                "but note:", "however,", "let's look", "we are to", "given the above",
                "so we", "but we don't know", "we have to", "let's consider",
                "we need to find", "we can assume", "first, note that",
            ]
            reasoning_hits = sum(1 for m in _reasoning_markers if m in text_lower)
            if reasoning_hits >= 4 and len(text) > 1500:
                for marker in ["therefore,", "so the answer", "in summary", "the next two", "answer:"]:
                    idx = text_lower.rfind(marker)
                    if idx != -1:
                        text = text[idx:].strip()
                        break
                else:
                    text = text[len(text) * 3 // 4:].strip()
                logger.info(f"_local_think: trimmed reasoning leak ({reasoning_hits} markers, kept {len(text)} chars)")
            text = re.sub(r'[^\x00-\x7F]+', '', text).strip()
            _filler_phrases = [
                "enhancing the alien", "creating a rich tapestry",
                "a fascinating interplay", "this creates a dynamic",
            ]
            sentences = re.split(r'(?<=[.!])\s+', text)
            sentences = [s for s in sentences
                         if not any(fp in s.lower() for fp in _filler_phrases)]
            text = " ".join(sentences).strip()
            if priority == "interactive":
                _ollama_interactive.clear()
            if not text:
                return (None, []) if return_context else None
            if return_context:
                return (text, result.get("context", []))
            return text
    except Exception as e:
        if priority == "interactive":
            _ollama_interactive.clear()
        logger.debug(f"_local_think unavailable: {e}")
        return (None, []) if return_context else None


def _read_module_source(module_name: str, max_chars: int = 3000) -> str:
    """Read the first N chars of a module's source file for grounding synthesis prompts."""
    import glob as _glob
    candidates = _glob.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", f"{module_name}.js"), recursive=True)
    if not candidates:
        candidates = _glob.glob(os.path.join(ctx.PROJECT_ROOT, "tools", "**", f"{module_name}.py"), recursive=True)
    if not candidates:
        return ""
    try:
        with open(candidates[0], encoding="utf-8", errors="ignore") as _f:
            content = _f.read()
        return content[:max_chars]
    except Exception:
        return ""


def _local_chat(messages: list[dict], model: str | None = None,
                max_tokens: int = 4096, temperature: float = 0.2) -> str | None:
    """Call Ollama /api/chat with a messages array (OpenAI-compatible multi-turn format).

    The model sees prior outputs as assistant turns it already produced, giving it a
    'continuation' mental model rather than treating prior context as external text.
    This is the Ollama equivalent of Claude's conversation memory — better coherence
    for multi-stage synthesis where each stage builds on the previous.

    messages: [{role: 'system'|'user'|'assistant', content: str}]
    Falls back to None if chat endpoint unavailable (caller should degrade gracefully).
    """
    import urllib.request
    active_lock = (_gpu0_lock if (model or _LOCAL_MODEL) == _LOCAL_MODEL
                   else _gpu1_lock if (model or _LOCAL_MODEL) == _REASONING_MODEL
                   else _ollama_lock)
    payload = {
        "model": model or _REASONING_MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": temperature, "num_predict": max_tokens},
    }
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        _LOCAL_CHAT_URL, data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with active_lock:
            resp_obj = urllib.request.urlopen(req, timeout=420)
        with resp_obj as resp:
            result = json.loads(resp.read())
            msg = result.get("message", {})
            text = msg.get("content", "").strip() if isinstance(msg, dict) else ""
            if "</think>" in text:
                text = text[text.rfind("</think>") + len("</think>"):].strip()
            elif "<think>" in text:
                text = text[text.find("<think>") + len("<think>"):].strip()
            text = re.sub(r'[^\x00-\x7F]+', '', text).strip()
            return text if text else None
    except Exception as e:
        logger.debug(f"_local_chat unavailable: {e}")
        return None


def _local_think_with_system(prompt: str, system: str, max_tokens: int = 1024,
                              model: str | None = None) -> str | None:
    """Call local Ollama model with an explicit system prompt."""
    import urllib.request
    body = json.dumps({
        "model": model or _LOCAL_MODEL,
        "system": system,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": max_tokens},
    }).encode()
    req = urllib.request.Request(
        _LOCAL_URL, data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            result = json.loads(resp.read())
            text = result.get("response", "").strip()
            if not text:
                return None
            text = re.sub(r'[^\x00-\x7F]+', '', text).strip()
            return text if text else None
    except Exception as e:
        logger.debug(f"_local_think_with_system unavailable: {e}")
        return None


def _two_stage_think(raw_context: str, question: str, max_tokens: int = 8192,
                     answer_format: str | None = None) -> str | None:
    """Multi-stage convergent synthesis: coder and reasoner ping-pong until answer converges.

    Stage 1 (qwen3-coder:30b, GPU 0): Extract and structure relevant facts into a brief.
    Stage 2 (qwen3:30b-a3b, GPU 1): Identify gaps in the brief — what's missing?
    Stage 3 (qwen3-coder:30b, GPU 0): Targeted re-extraction for just the gaps.
    Stage 4 (qwen3:30b-a3b, GPU 1): Final answer from accumulated brief.

    Convergence: if Stage 2 finds no gaps, skip Stage 3 and answer immediately.
    Falls back to single-stage reasoning if Stage 1 fails.
    answer_format: override the default FILE/FUNCTION/SIGNAL/EFFECT format instruction.
    """
    _STAGE1_SYSTEM = (
        "You are a code extraction assistant for the Polychron music synthesis project. "
        "Extract code facts only. No reasoning, no analysis, no opinions. "
        "Output: file paths, function names, signal fields, correlation values, bridge status."
    )
    frame_prompt = (
        "Extract ONLY the facts relevant to answering this question:\n"
        f"  {question}\n\n"
        "Rules:\n"
        "- Preserve EXACT file paths (src/crossLayer/...), function names, signal field names, and KB entry titles\n"
        "- For each relevant module: state its file, its coupling dimensions, and its antagonist pair\n"
        "- Mark pairs as VIRGIN (0 bridges), PARTIAL (1-2), or SATURATED (3+)\n"
        "- Preserve code snippets that directly relate\n"
        "- Max 500 words\n\n"
        "Raw project context:\n" + raw_context[:8000]
    )
    frame_result = _local_think(frame_prompt, max_tokens=2000, model=_LOCAL_MODEL,
                                system=_STAGE1_SYSTEM, temperature=0.1, return_context=True)
    frame = frame_result[0] if isinstance(frame_result, tuple) else frame_result
    stage1_kv_ctx = frame_result[1] if isinstance(frame_result, tuple) else []

    if not frame or len(frame) < 40 or "src/" not in frame:
        return _local_think(
            raw_context[:6000] + "\n\n" + question,
            max_tokens=max_tokens, model=_REASONING_MODEL,
            system=_THINK_SYSTEM,
        )

    gap_prompt = (
        "/no_think Brief about the Polychron codebase:\n\n" + frame + "\n\n"
        "Question to answer: " + question + "\n\n"
        "What SPECIFIC facts are MISSING from this brief that are needed to answer the question?\n"
        "List each gap as: NEED: <what is missing>\n"
        "If the brief has everything needed, respond with exactly: NO GAPS\n"
        "Max 5 gaps."
    )
    gaps = _local_think(gap_prompt, max_tokens=500, model=_REASONING_MODEL, temperature=0.2,
                        system=_THINK_SYSTEM)

    if gaps and "NO GAP" not in gaps.upper() and "NEED:" in gaps:
        supplement_prompt = (
            "The following information is MISSING from a previous extraction.\n"
            "Extract ONLY these specific facts:\n\n"
            + gaps + "\n\n"
            "Output only the missing facts. Max 300 words."
        )
        supplement = _local_think(supplement_prompt, max_tokens=1000, model=_LOCAL_MODEL,
                                  system=_STAGE1_SYSTEM, temperature=0.1,
                                  context=stage1_kv_ctx if stage1_kv_ctx else None)
        if supplement and len(supplement) > 20:
            frame = frame + "\n\n## Supplemental extraction:\n" + supplement
            logger.info(f"_two_stage_think: gap-fill round added {len(supplement)} chars")

    abbreviated_context = raw_context[:2000]
    _fmt = answer_format if answer_format else (
        "Answer using ONLY modules, files, signals, and functions named in the brief. "
        "Do NOT invent names. "
        "Format each item as:\n"
        "  FILE: path, FUNCTION: name, SIGNAL: field, EFFECT: one sentence.\n"
        "Max 4 items. No prose paragraphs."
    )
    reason_prompt = (
        "/no_think Structured brief about the Polychron codebase:\n\n"
        + frame + "\n\n"
        "Additional raw context (cross-reference only):\n" + abbreviated_context + "\n\n"
        "Question: " + question + "\n\n"
        + _fmt
    )
    return _local_think(reason_prompt, max_tokens=max_tokens, model=_REASONING_MODEL,
                        system=_THINK_SYSTEM)


def _parallel_two_stage_think(raw_context: str, question: str, max_tokens: int = 8192) -> str | None:
    """True parallel two-GPU synthesis. GPU 0 and GPU 1 run simultaneously in Stage 1.

    Stage 1A (qwen3-coder:30b, GPU 0): Extract structured code facts — file paths,
      function names, signal fields, bridge status. Deterministic (temp=0.1).
    Stage 1B (qwen3:30b-a3b, GPU 1): Independent first-pass analysis — coupling
      patterns, musical effects, antagonism logic. Speculative (temp=0.2).
    Both run simultaneously via threading.Thread with per-GPU locks.

    Stage 2 (GPU 1): Final synthesis from merged Stage 1A + 1B briefs.

    Performance: ~max(GPU0_time, GPU1_time) instead of sum — roughly 2× faster
    than the 4-stage sequential flow for most questions.
    Falls back to _two_stage_think if threading fails.
    """
    import threading

    _q_lower = question.lower()
    _is_evolution_q = any(k in _q_lower for k in [
        "next bridge", "antagonist", "leverage", "which pair", "best signal",
        "next evolution", "virgin pair", "best next", "bridge opportunity",
        "coupling round", "next round", "bridge candidate",
    ])

    _EXTRACT_SYSTEM = (
        "You are a code extraction assistant for the Polychron music synthesis project. "
        "Extract code facts only. No reasoning, no analysis, no opinions. "
        "Output: file paths, signal fields, correlation values, bridge status. NO function names."
    )

    _ollama_interactive.set()

    results = [None, None]

    def _gpu0_extract():
        if _is_evolution_q:
            prompt = (
                "Extract antagonist pair data relevant to:\n"
                f"  {question}\n\n"
                "For each relevant PAIR: module names, r-value, already-bridged signals, "
                "candidate unused signals with directions (A does X / B does Y opposing).\n"
                "Mark pairs: VIRGIN (0 bridges), PARTIAL (1-2), SATURATED (3+).\n"
                "Max 400 words. NO function names.\n\n"
                "Raw context:\n" + raw_context[:8000]
            )
        else:
            prompt = (
                "Extract ONLY the facts relevant to answering:\n"
                f"  {question}\n\n"
                "Rules:\n"
                "- EXACT file paths (src/crossLayer/...), signal field names\n"
                "- For each relevant module: file path, coupling dimensions, antagonist pair\n"
                "- Mark pairs: VIRGIN (0 bridges), PARTIAL (1-2), SATURATED (3+)\n"
                "- Code snippets that directly relate\n"
                "- Max 400 words. NO function names.\n\n"
                "Raw context:\n" + raw_context[:8000]
            )
        results[0] = _local_think(prompt, max_tokens=2000, model=_LOCAL_MODEL,
                                   system=_EXTRACT_SYSTEM, temperature=0.1,
                                   priority="parallel")

    def _gpu1_analyze():
        prompt = (
            "/no_think Question: " + question + "\n\n"
            "Analyze this Polychron codebase context. What coupling patterns, antagonism "
            "bridges, or signal flows directly answer this question?\n"
            "Be specific: name modules, exact fields, and effects.\n"
            "Max 300 words.\n\n"
            "Context:\n" + raw_context[:6000]
        )
        results[1] = _local_think(prompt, max_tokens=1200, model=_REASONING_MODEL,
                                   system=_THINK_SYSTEM, temperature=0.2, priority="parallel")

    try:
        t0 = threading.Thread(target=_gpu0_extract, daemon=True)
        t1 = threading.Thread(target=_gpu1_analyze, daemon=True)
        t0.start()
        t1.start()
        t0.join(timeout=450)
        t1.join(timeout=450)
    finally:
        _ollama_interactive.clear()

    gpu0_out, gpu1_out = results[0], results[1]

    if not gpu0_out and not gpu1_out:
        logger.warning("_parallel_two_stage_think: both stages failed, falling back to sequential")
        return _two_stage_think(raw_context, question, max_tokens)

    # ── Stage 1.5: Arbiter triage (qwen3:4b, thinks then classifies) ──
    # Runs during GPU idle time between stages. Classifies conflicts as:
    #   ALIGNED → proceed to Stage 2
    #   MINOR   → inject advisory note into Stage 2 brief
    #   COMPLEX → escalate to Stage 1.75 (reasoning model resolves before Stage 2)
    arbiter_result = _arbiter_check(gpu0_out, gpu1_out, question)

    merged_parts = []
    if gpu0_out and len(gpu0_out) > 30:
        merged_parts.append("## Structural Facts (extracted)\n" + gpu0_out)
    if gpu1_out and len(gpu1_out) > 30:
        merged_parts.append("## Coupling Analysis (reasoned)\n" + gpu1_out)

    if arbiter_result and arbiter_result["severity"] == "complex":
        # ── Stage 1.75: Deep conflict resolution (GPU1 reasoning model) ──
        # Fundamental contradiction — reasoning model reconciles before Stage 2
        resolved = _resolve_complex_conflict(
            gpu0_out, gpu1_out, arbiter_result["report"], question
        )
        if resolved:
            merged_parts.append("## Conflict Resolution (Stage 1.75)\n" + resolved)
        else:
            merged_parts.append(
                "## Arbiter: COMPLEX Conflict (unresolved)\n" + arbiter_result["report"]
            )
    elif arbiter_result and arbiter_result["severity"] == "minor":
        merged_parts.append("## Arbiter Advisory\n" + arbiter_result["report"])

    merged = "\n\n".join(merged_parts) if merged_parts else (gpu0_out or gpu1_out or "")

    if _is_evolution_q:
        _fmt_instruction = (
            "Format each recommendation as:\n"
            "  PAIR: moduleA↔moduleB (r=value), SIGNAL: fieldName, "
            "DIRECTION: moduleA raises X when field high / moduleB lowers Y when field high."
        )
    else:
        _fmt_instruction = (
            "Format each finding as:\n"
            "  FILE: path, SIGNAL: field, EFFECT: one sentence."
        )
    chat_messages = [
        {
            "role": "system",
            "content": _THINK_SYSTEM + " Answer only from facts in the conversation. Do NOT invent module names, function names, or signal fields. /no_think"
        },
        {
            "role": "user",
            "content": (
                f"Analyze the Polychron codebase for:\n  {question}\n\n"
                "Context:\n" + raw_context[:2000]
            )
        },
        {
            "role": "assistant",
            "content": merged
        },
        {
            "role": "user",
            "content": (
                "/no_think Based on your analysis, answer the question:\n  " + question + "\n\n"
                "Use ONLY modules and signals from your analysis above. " + _fmt_instruction + "\n"
                "Max 4 items. No prose."
            )
        },
    ]
    result = _local_chat(chat_messages, model=_REASONING_MODEL, max_tokens=max_tokens, temperature=0.15)
    if not result:
        fallback_prompt = ("Based on this analysis:\n\n" + merged + "\n\nAnswer: " + question +
                           "\n\n" + _fmt_instruction + "\nMax 4 items. /no_think")
        result = _local_think(fallback_prompt, max_tokens=max_tokens, model=_REASONING_MODEL)
    if result:
        logger.info(f"_parallel_two_stage_think: merged {len(gpu0_out or '')}+{len(gpu1_out or '')} chars → {len(result)} chars answer (chat)")
    return result or merged
