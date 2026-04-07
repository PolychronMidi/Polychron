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
# Benefits: persona+KB context pre-tokenized once, reused across calls via Ollama
# context= array (token IDs, not text). Avoids repeated tokenization overhead.
#
# GPU memory reality: qwen3-coder:30b uses ~21GB of the 24GB card, leaving <600 MiB
# free. KV cache for 7350 tokens = ~2756 MiB — does NOT fit in VRAM. Ollama spills
# it to RAM (64GB available). Warm context still saves tokenization cost; it just
# lives in RAM, not GPU. This is correct behavior — don't try to "fill" GPU space.
_warm_ctx: dict[str, list] = {}          # model → Ollama context array
_warm_ctx_kb_ver: dict[str, int] = {}    # model → kb_version when primed
_warm_ctx_ts: dict[str, float] = {}      # model → epoch timestamp of last priming

# ── Think continuation ────────────────────────────────────────────────────
# Cross-call memory for the think tool. Stores the last 3 think Q&A pairs as text
# and injects them as conversation history in subsequent think calls. This gives
# the think tool continuous session memory without growing the KV cache unboundedly.
_think_history: list[dict] = []           # [{about, answer}] sliding window
_THINK_HISTORY_MAX = 3                    # keep last N exchanges

# ── Unified session narrative ─────────────────────────────────────────────
# A running prose thread of what's happening this session — orthogonal to both
# think history (narrow Q&A) and KB (static facts). Captures session direction,
# key decisions, arbiter resolutions, and pipeline verdicts. Injected into every
# synthesis call so all three models share the same session context.
#
# Persisted to metrics/hme-session-state.json so IDE restarts don't wipe context.
# Loaded at module init; written on every append.
_session_narrative: list[dict] = []       # [{seq, event, content}] rolling window
_session_narrative_seq: int = 0           # monotonic event counter
_SESSION_NARRATIVE_MAX = 10              # keep last N events

_SESSION_STATE_FILE = None  # resolved lazily once PROJECT_ROOT is set — tools/HME/session-state.json


_session_state_loaded = False


def _session_state_path() -> str | None:
    """Resolve path to session state file, or None if PROJECT_ROOT not yet set."""
    global _SESSION_STATE_FILE
    if _SESSION_STATE_FILE:
        return _SESSION_STATE_FILE
    root = getattr(ctx, "PROJECT_ROOT", "")
    if root:
        _SESSION_STATE_FILE = os.path.join(root, "tools", "HME", "session-state.json")
        return _SESSION_STATE_FILE
    return None


def _load_session_state():
    """Load persisted narrative + think history from disk. Lazy — runs once when PROJECT_ROOT
    is available. Safe to call multiple times (no-ops after first load)."""
    global _session_narrative, _session_narrative_seq, _think_history, _session_state_loaded
    if _session_state_loaded:
        return
    path = _session_state_path()
    if not path:
        return  # PROJECT_ROOT not yet set — try again later
    _session_state_loaded = True
    if not os.path.exists(path):
        return
    try:
        with open(path) as f:
            data = json.load(f)
        _session_narrative = data.get("narrative", [])[-_SESSION_NARRATIVE_MAX:]
        _session_narrative_seq = data.get("seq", 0)
        _think_history = data.get("think_history", [])[-_THINK_HISTORY_MAX:]
        logger.info(
            f"session state loaded: {len(_session_narrative)} narrative events, "
            f"{len(_think_history)} think exchanges"
        )
    except Exception as e:
        logger.warning(f"session state load failed: {e}")


def _save_session_state():
    """Persist narrative + think history to disk. Called after every write."""
    path = _session_state_path()
    if not path:
        return
    try:
        with open(path, "w") as f:
            json.dump({
                "narrative": _session_narrative,
                "seq": _session_narrative_seq,
                "think_history": _think_history,
            }, f, indent=2)
    except Exception as e:
        logger.warning(f"session state save failed: {e}")


def _ollama_background_yield():
    """Called by background tasks before each Ollama call. If an interactive call
    is waiting, yields by sleeping until it clears."""
    while _ollama_interactive.is_set():
        import time as _t
        _t.sleep(0.5)


def _gpu_persona(model: str) -> str:
    """Model-specialized persona for warm context priming.
    GPU0 (extractor): structured code facts — paths, signals, correlations.
    GPU1 (reasoner): musical effects, evolution strategy, coupling analysis.
    Arbiter: conflict detection between independent analyses.
    All models receive the full KB (all entries, 300-char content) to maximize
    pre-tokenized code awareness. KV cache spills to RAM (models use ~21GB of
    24GB VRAM, leaving <600 MiB — not enough for 7K-token KV cache in VRAM)."""
    import glob as _glob
    # Full KB — all entries, 300-char content truncation (was last 8 at 120 chars)
    full_kb = ""
    try:
        all_kb = ctx.project_engine.list_knowledge_full() or []
        full_kb = "\n".join(
            f"  [{k.get('category','')}] {k.get('title','')}: {k.get('content','')[:300]}"
            for k in all_kb
        )
    except Exception:
        pass
    # Real crossLayer module names from filesystem (dynamic, never stale)
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
        return (
            "You are the code extractor for Polychron, a self-evolving alien generative music "
            "system with 19 hypermeta controllers and 26 cross-layer modules. "
            "Your role: extract FACTS. File paths (src/crossLayer/...), signal fields, "
            "correlation values, coupling dimensions, bridge status (VIRGIN/PARTIAL/SATURATED). "
            "Antagonism bridges couple BOTH modules of a negatively-correlated pair to the "
            "SAME signal with OPPOSING effects. Never reason or opine — output raw data only.\n"
            "Real crossLayer modules: " + modules_str + ".\n\n"
            "Full KB (ground truth, " + str(len(full_kb.split('\n'))) + " entries):\n" + full_kb
        )
    if model == _ARBITER_MODEL:
        # Dynamic signal fields from index symbols (don't hardcode — they evolve with the codebase)
        _signal_fields = []
        try:
            _l0_files = _glob.glob(
                os.path.join(ctx.PROJECT_ROOT, "src", "conductor", "signal", "**", "*.js"),
                recursive=True
            )
            # Pull field names from L0 channel definitions
            import re as _re
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
        return (
            "You are the arbiter for Polychron, a self-evolving alien generative music system. "
            "Your role: compare two independent code analyses and detect contradictions, "
            "hallucinated module names, and overlooked facts. "
            "Real crossLayer modules: " + modules_str + ". "
            "Known signal fields: " + ", ".join(_signal_fields) + ". "
            "If an analysis cites a module or field NOT in these lists, flag it.\n\n"
            "Full KB (ground truth):\n" + full_kb
        )
    # Reasoner persona: full KB + module list so it never invents names
    return (
        _THINK_SYSTEM + "\n\n"
        "Synthesize facts into actionable insights about musical effects, coupling patterns, "
        "and evolution strategy. Cite specific file paths and signal fields. Never invent "
        "module names not in this list: " + modules_str + ".\n\n"
        "Full KB (ground truth, " + str(len(full_kb.split('\n'))) + " entries):\n" + full_kb
    )


def _prime_warm_context(model: str) -> bool:
    """Prime warm KV context for a specific model.
    Embeds GPU-specialized persona + recent KB into the model's KV cache.
    Background priority (yields to interactive). Skips if KB unchanged."""
    kb_ver = getattr(ctx, "_kb_version", 0)
    if _warm_ctx_kb_ver.get(model) == kb_ver and model in _warm_ctx:
        logger.debug(f"warm ctx already fresh: {model} (kb_ver={kb_ver})")
        return True
    logger.info(f"warm ctx priming: {model} (kb_ver={kb_ver}) — sending Ollama request...")
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
        logger.info(f"warm ctx PRIMED: {model} ({len(result[1])} ctx tokens, kb_ver={kb_ver})")
        return True
    logger.warning(f"warm ctx priming FAILED: {model} (Ollama returned no context)")
    return False


def _prime_all_gpus() -> str:
    """Prime all three models in parallel threads. Returns status summary."""
    import time as _t
    results = [False, False, False]
    def _do0():
        results[0] = _prime_warm_context(_LOCAL_MODEL)
    def _do1():
        results[1] = _prime_warm_context(_REASONING_MODEL)
    def _do2():
        results[2] = _prime_warm_context(_ARBITER_MODEL)
    t0 = _t.time()
    threads = [
        _threading.Thread(target=_do0, daemon=True),
        _threading.Thread(target=_do1, daemon=True),
        _threading.Thread(target=_do2, daemon=True),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=120)
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
    status["think_history"] = len(_think_history)
    status["session_narrative"] = len(_session_narrative)
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
    session_ctx = get_session_narrative()
    prompt = (
        (session_ctx if session_ctx else "") +
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
    payload = {
        "model": _ARBITER_MODEL, "prompt": prompt, "stream": False,
        "options": {"temperature": 0.0, "num_predict": 600},
    }
    # Use warm context if primed — arbiter knows real module names and signal fields
    arbiter_ctx = _warm_ctx.get(_ARBITER_MODEL)
    if arbiter_ctx and _warm_ctx_kb_ver.get(_ARBITER_MODEL) == getattr(ctx, "_kb_version", 0):
        payload["context"] = arbiter_ctx
        logger.debug(f"arbiter: warm ctx hit ({len(arbiter_ctx)} tokens)")
    body = json.dumps(payload).encode()
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
        append_session_narrative(
            "arbiter_resolved",
            f"COMPLEX conflict on '{question[:60]}' resolved by Stage 1.75"
        )
    return resolved


def compress_for_claude(text: str, max_chars: int = 600, hint: str = "") -> str:
    """Compress verbose tool output using the arbiter model before returning to Claude.

    The arbiter (qwen3:4b) acts as a context efficiency manager: it reads the full
    analysis and emits a compact summary that preserves actionable signal while cutting
    prose explanation, context preamble, and repetition. This keeps Claude's context
    window lean without losing synthesis quality — Ollama did the full analysis, Claude
    only needs the conclusion.

    hint: optional one-sentence context about what the text contains (e.g. 'evolution
    proposals for crossLayer modules') to help the arbiter focus its compression.
    Falls back to truncation if arbiter is unavailable or too slow.
    """
    if len(text) <= max_chars:
        return text
    import urllib.request
    hint_prefix = f"Context: {hint}\n\n" if hint else ""
    prompt = (
        hint_prefix +
        f"Compress the following to ≤{max_chars} characters. "
        "Preserve: file paths (src/...), signal field names, module names, numbers, "
        "and concrete action verbs. Remove: prose preamble, redundant explanation, "
        "verbose 'why' sections that repeat what the action already implies. "
        "Output the compressed version ONLY — no meta-commentary.\n\n"
        f"INPUT:\n{text[:4000]}"
    )
    payload = {
        "model": _ARBITER_MODEL, "prompt": prompt, "stream": False,
        "options": {"temperature": 0.0, "num_predict": max(150, max_chars // 3)},
    }
    arbiter_ctx = _warm_ctx.get(_ARBITER_MODEL)
    if arbiter_ctx and _warm_ctx_kb_ver.get(_ARBITER_MODEL) == getattr(ctx, "_kb_version", 0):
        payload["context"] = arbiter_ctx
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        _LOCAL_URL, data=body, headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            compressed = result.get("response", "").strip()
            if "</think>" in compressed:
                compressed = compressed[compressed.rfind("</think>") + len("</think>"):].strip()
            compressed = re.sub(r'[^\x00-\x7F]+', '', compressed).strip()
            if compressed and len(compressed) < len(text):
                logger.debug(f"compress_for_claude: {len(text)} → {len(compressed)} chars")
                return compressed
    except Exception as e:
        logger.debug(f"compress_for_claude: arbiter unavailable ({e}), falling back to truncation")
    # Fallback: hard truncation
    return text[:max_chars] + f"…(+{len(text) - max_chars} chars)"


def store_think_history(about: str, answer: str):
    """Store a think Q&A pair for cross-call continuation."""
    _think_history.append({"about": about, "answer": answer[:300]})
    while len(_think_history) > _THINK_HISTORY_MAX:
        _think_history.pop(0)
    # Also feed the session narrative: one compact sentence from the think topic
    narrative_entry = about[:80] + (": " + answer[:60] + "..." if answer else "")
    append_session_narrative("think", narrative_entry)
    # Note: _save_session_state() is called inside append_session_narrative above


def get_think_history_context() -> str:
    """Get formatted think history for injection into subsequent think calls."""
    _load_session_state()
    if not _think_history:
        return ""
    lines = [f"  Q: {h['about'][:80]} → {h['answer'][:150]}" for h in _think_history]
    return "Previous think exchanges this session:\n" + "\n".join(lines) + "\n\n"


def append_session_narrative(event: str, content: str):
    """Append an event to the unified session narrative.

    event: short label for the event type (e.g. 'think', 'arbiter_resolved',
           'pipeline', 'evolution', 'knowledge_added')
    content: one compact sentence describing what happened / was decided (≤80 chars).
    Called automatically from store_think_history and _resolve_complex_conflict.
    External callers (pipeline hooks, add_knowledge, evolution tools) may call directly.
    Persisted to disk so narrative survives IDE restarts.
    """
    global _session_narrative_seq
    _session_narrative_seq += 1
    _session_narrative.append({
        "seq": _session_narrative_seq,
        "event": event,
        "content": content[:100],
    })
    while len(_session_narrative) > _SESSION_NARRATIVE_MAX:
        _session_narrative.pop(0)
    _save_session_state()


def get_session_narrative() -> str:
    """Returns the unified session narrative block for injection into any model call.

    Provides ALL models with a shared thread of what this session is about —
    direction, decisions, pipeline verdicts, arbiter resolutions. This is the
    4th context layer (orthogonal to KB/warm-ctx/think-history): dynamic session prose.
    Persisted across IDE restarts — tools/HME/session-state.json.
    """
    _load_session_state()
    if not _session_narrative:
        return ""
    lines = [f"  [{e['seq']}:{e['event']}] {e['content']}" for e in _session_narrative]
    return "Session narrative (this session's work so far):\n" + "\n".join(lines) + "\n\n"


_lazy_prime_attempted = False

def _ensure_warm(model: str):
    """Lazy warm context priming — fires on first synthesis call if not already primed.
    Non-blocking: runs in a background thread so the first call isn't delayed.
    Subsequent calls check _warm_ctx dict directly (instant).
    If Ollama was down at first attempt, resets _lazy_prime_attempted so the next call retries.
    """
    global _lazy_prime_attempted
    if model in _warm_ctx:
        return  # already primed — fast path
    if _lazy_prime_attempted:
        return  # background thread already running or recently attempted
    _lazy_prime_attempted = True
    def _bg():
        global _lazy_prime_attempted
        try:
            ok0 = _prime_warm_context(_LOCAL_MODEL)
            ok1 = _prime_warm_context(_REASONING_MODEL)
            ok2 = _prime_warm_context(_ARBITER_MODEL)
            if not any([ok0, ok1, ok2]):
                # All failed (Ollama likely down) — allow future retry
                _lazy_prime_attempted = False
                logger.info("lazy warm priming: all failed, will retry on next synthesis call")
        except Exception:
            _lazy_prime_attempted = False
    _threading.Thread(target=_bg, daemon=True).start()
    logger.info("lazy warm context priming started (background)")


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

    # Lazy warm: kick off background priming on first interactive call
    if priority == "interactive" and system == _THINK_SYSTEM:
        _ensure_warm(_effective_model)

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

    # ── Inject session narrative into synthesis calls ──
    # Inject when: (a) _THINK_SYSTEM — reasoner synthesis calls, or
    #              (b) warm KV context is active (system was cleared by the swap above).
    # Do NOT inject when an extractor call passes its own context array (stage1_kv_ctx)
    # with system=_STAGE1_SYSTEM — extractors need clean context, not session prose.
    if system == _THINK_SYSTEM or (system == "" and context is not None):
        narrative = get_session_narrative()
        if narrative and not prompt.startswith("Session narrative"):
            prompt = narrative + prompt

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
            # Trim leaked reasoning preamble (same markers as _local_think)
            _reasoning_markers = [
                "but note:", "however,", "let's look", "we are to", "given the above",
                "so we", "but we don't know", "we have to", "let's consider",
                "we need to find", "we can assume", "first, note that",
                "now, let's", "let's structure",
            ]
            text_lower = text.lower()
            reasoning_hits = sum(1 for m in _reasoning_markers if m in text_lower)
            if reasoning_hits >= 3 and len(text) > 200:
                for marker in ["therefore,", "so the answer", "in summary", "answer:", "file:", "pair:"]:
                    idx = text_lower.rfind(marker)
                    if idx != -1:
                        text = text[idx:].strip()
                        break
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
    """Three-model five-stage synthesis pipeline.

    Stage 1A (qwen3-coder:30b, GPU 0): Extract structured code facts.
    Stage 1B (qwen3:30b-a3b, GPU 1): Independent coupling/musical analysis.
      Both run simultaneously via threading.Thread with per-GPU locks.

    Stage 1.5 (qwen3:4b, arbiter): Triage conflict detection between 1A/1B.
      Classifies as ALIGNED (proceed), MINOR (advisory note), or COMPLEX (escalate).

    Stage 1.75 (qwen3:30b-a3b, GPU 1): Deep conflict resolution.
      Only runs on COMPLEX conflicts — reasoning model reconciles contradictions
      so Stage 2 works from a corrected brief.

    Stage 2 (qwen3:30b-a3b, GPU 1): Final synthesis from merged + resolved brief.

    Performance: Stage 1 is parallel (~max of GPU times). Arbiter runs during GPU
    idle. Stage 1.75 only fires on complex conflicts (~10% of questions).
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
    # Inject session narrative into Stage 2 so the final synthesizer knows session direction
    _narrative_prefix = get_session_narrative()
    chat_messages = [
        {
            "role": "system",
            "content": _THINK_SYSTEM + " Answer only from facts in the conversation. Do NOT invent module names, function names, or signal fields. /no_think"
        },
        {
            "role": "user",
            "content": (
                (_narrative_prefix if _narrative_prefix else "") +
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
                "Max 4 items. No prose. No explanation. Start your response immediately with the first item."
            )
        },
        {
            "role": "assistant",
            "content": "1."
        },
    ]
    result = _local_chat(chat_messages, model=_REASONING_MODEL, max_tokens=max_tokens, temperature=0.15)
    if not result:
        fallback_prompt = ("Based on this analysis:\n\n" + merged + "\n\nAnswer: " + question +
                           "\n\n" + _fmt_instruction + "\nMax 4 items. /no_think")
        result = _local_think(fallback_prompt, max_tokens=max_tokens, model=_REASONING_MODEL)

    # Build pipeline trace for transparency
    _trace_parts = [f"1A:{len(gpu0_out or '')}c", f"1B:{len(gpu1_out or '')}c"]
    if arbiter_result:
        sev = arbiter_result["severity"].upper()
        _trace_parts.append(f"arbiter:{sev}")
        if sev == "COMPLEX":
            _trace_parts.append("1.75:resolved" if "Conflict Resolution" in merged else "1.75:failed")
    else:
        _trace_parts.append("arbiter:ALIGNED")
    _trace_parts.append(f"2:{len(result or '')}c")
    _trace = " → ".join(_trace_parts)

    if result:
        result = result + f"\n\n*pipeline: {_trace}*"
        logger.info(f"_parallel_two_stage_think: {_trace}")
    return result or merged
