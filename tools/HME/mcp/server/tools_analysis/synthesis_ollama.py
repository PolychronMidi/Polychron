"""HME Ollama synthesis layer — local model inference, priority queue, compress_for_claude."""
import json
import os
import re
import logging
import threading as _threading

from server import context as ctx
from .synthesis_config import _THINK_SYSTEM

logger = logging.getLogger("HME")

# Tracks the reason for the last synthesis failure so tools can surface actionable messages.
# "timeout" means Ollama timed out and queue may be stacked — caller should NOT retry immediately.
# "error" means a non-timeout failure (connection refused, JSON parse error, etc.).
# None means no recent failure.
_last_think_failure: str | None = None
_last_think_failure_ts: float = 0.0  # monotonic timestamp of last failure
_TIMEOUT_COOLDOWN_S = 120  # seconds to refuse new requests after a timeout


_LOCAL_MODEL = os.environ.get("HME_LOCAL_MODEL", "qwen3-coder:30b")
# Reasoning model: Qwen3-30B-A3B (MoE, 3B active params, hybrid thinking mode).
# Beats QwQ-32B and DeepSeek-R1 on reasoning benchmarks at lower compute.
# ~18.6GB Q4 — fits on one M40.
_REASONING_MODEL = os.environ.get("HME_REASONING_MODEL", "qwen3:30b-a3b")
# Arbiter model: Qwen3 4B (~2.5GB Q4) — runs during GPU idle between Stage 1 and Stage 2.
# Ollama auto-schedules GPU layers; falls back to CPU/RAM (64GB) when GPUs are busy.
_ARBITER_MODEL = os.environ.get("HME_ARBITER_MODEL", "qwen3:4b")

# keep_alive=-1: pin models permanently. num_ctx: explicit full context window.
# 3 models at full 32768 ctx uses ~18GB RAM for KV caches (well within 52GB available).
_KEEP_ALIVE = int(os.environ.get("HME_KEEP_ALIVE", "-1"))
_NUM_CTX_30B = int(os.environ.get("HME_NUM_CTX_30B", "32768"))
_NUM_CTX_4B  = int(os.environ.get("HME_NUM_CTX_4B",  "8192"))

def _num_ctx_for(model: str) -> int:
    return _NUM_CTX_4B if model == _ARBITER_MODEL else _NUM_CTX_30B

_LOCAL_URL = os.environ.get("HME_LOCAL_URL", "http://localhost:11434/api/generate")
# /api/chat: multi-turn format, model sees prior outputs as assistant turns it produced.
_LOCAL_CHAT_URL = _LOCAL_URL.replace("/api/generate", "/api/chat")


# ── Ollama priority queue ──────────────────────────────────────────────────
# Interactive calls (think, before_editing) must not be blocked by background warm.
# _ollama_interactive: set by interactive callers; background tasks yield until cleared.
_ollama_interactive = _threading.Event()
_ollama_lock = _threading.Lock()
_gpu0_lock = _threading.Lock()   # qwen3-coder:30b (extraction)
_gpu1_lock = _threading.Lock()   # qwen3:30b-a3b (reasoning)


def _ollama_background_yield():
    """Yield to interactive calls before each background Ollama request."""
    while _ollama_interactive.is_set():
        import time as _t
        _t.sleep(0.5)


def _local_think(prompt: str, max_tokens: int = 8192, model: str | None = None,
                 priority: str = "interactive", system: str = "",
                 temperature: float = 0.3, context: list | None = None,
                 return_context: bool = False) -> str | tuple | None:
    """Call local Ollama model for synthesis tasks.

    Returns None if Ollama isn't running. Returns (text, context_array) when
    return_context=True — context_array is the Ollama KV cache state for reuse.
    On empty text (model used all tokens for thinking), returns (None, context_array)
    so warm priming can capture the KV state even without visible output.
    system: auto-swapped for warm KV context when system==_THINK_SYSTEM (transparent speedup).
    """
    import urllib.request
    import time as _time_mod

    # Timeout cooldown: refuse new requests while queue may be stacked
    global _last_think_failure, _last_think_failure_ts
    if _last_think_failure == "timeout":
        _elapsed = _time_mod.monotonic() - _last_think_failure_ts
        if _elapsed < _TIMEOUT_COOLDOWN_S:
            _remaining = int(_TIMEOUT_COOLDOWN_S - _elapsed)
            logger.warning(
                f"_local_think REFUSED — {_remaining}s remaining in {_TIMEOUT_COOLDOWN_S}s "
                "timeout cooldown. Ollama queue may still be stacked."
            )
            return (None, []) if return_context else None
        _last_think_failure = None

    if priority == "background":
        _ollama_background_yield()
    elif priority == "interactive":
        _ollama_interactive.set()

    _effective_model = model or _LOCAL_MODEL

    # Lazy warm: kick off background priming on first interactive call
    if priority == "interactive" and system == _THINK_SYSTEM:
        from .synthesis_warm import ensure_warm
        ensure_warm(_effective_model)

    # Auto-warm: swap system= for warm KV context when available and fresh
    if system == _THINK_SYSTEM and context is None:
        from .synthesis_warm import _warm_ctx, _warm_ctx_kb_ver
        warm = _warm_ctx.get(_effective_model)
        kb_ver = getattr(ctx, "_kb_version", 0)
        if warm and _warm_ctx_kb_ver.get(_effective_model) == kb_ver:
            context = warm
            system = ""
            logger.debug(f"_local_think: warm ctx hit ({len(warm)} tokens, {_effective_model})")

    # Inject session narrative into synthesis calls
    if system == _THINK_SYSTEM or (system == "" and context is not None):
        from .synthesis_session import get_session_narrative
        narrative = get_session_narrative()
        if narrative and not prompt.startswith("Session narrative"):
            prompt = narrative + prompt

    payload: dict = {
        "model": _effective_model,
        "prompt": prompt,
        "stream": False,
        "keep_alive": _KEEP_ALIVE,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
            "num_ctx": _num_ctx_for(_effective_model),
        },
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
        active_lock = (_gpu0_lock if _effective_model == _LOCAL_MODEL
                       else _gpu1_lock if _effective_model == _REASONING_MODEL
                       else _ollama_lock)
        # Background warm priming: 3 models queue serially in Ollama, each waiting for others.
        # 900s covers worst case (~15 min total for 3 large persona prompts).
        _http_timeout = 900 if priority == "background" else 420
        with active_lock:
            resp_obj = urllib.request.urlopen(req, timeout=_http_timeout)
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
                    # Return context even on empty text — warm priming needs KV state
                    return (None, result.get("context", [])) if return_context else None
            _hallucination_markers = [
                "in this hypothetical scenario", "as an AI", "I don't have access",
                "this document provides", "these documents provide",
                "as a language model", "i cannot determine",
            ]
            if any(m in text.lower() for m in _hallucination_markers):
                logger.info(f"_local_think: suppressed hallucinated output ({len(text)} chars)")
                if priority == "interactive":
                    _ollama_interactive.clear()
                return None
            _reasoning_markers = [
                "but note:", "however,", "let's look", "we are to", "given the above",
                "so we", "but we don't know", "we have to", "let's consider",
                "we need to find", "we can assume", "first, note that",
            ]
            reasoning_hits = sum(1 for m in _reasoning_markers if m in text.lower())
            if reasoning_hits >= 4 and len(text) > 1500:
                for marker in ["therefore,", "so the answer", "in summary", "the next two", "answer:"]:
                    idx = text.lower().rfind(marker)
                    if idx != -1:
                        text = text[idx:].strip()
                        break
                else:
                    text = text[len(text) * 3 // 4:].strip()
            text = re.sub(r'[^\x00-\x7F]+', '', text).strip()
            _filler_phrases = [
                "enhancing the alien", "creating a rich tapestry",
                "a fascinating interplay", "this creates a dynamic",
            ]
            sentences = re.split(r'(?<=[.!])\s+', text)
            text = " ".join(s for s in sentences if not any(fp in s.lower() for fp in _filler_phrases)).strip()
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
        _err_str = str(e).lower()
        _is_timeout = ("timed out" in _err_str or "timeout" in type(e).__name__.lower()
                       or "urlopen error" in _err_str)
        if _is_timeout:
            _last_think_failure = "timeout"
            _last_think_failure_ts = _time_mod.monotonic()
            logger.warning(
                f"_local_think TIMEOUT ({_effective_model}) — Ollama queue may be stacked. "
                "Do NOT retry immediately. Wait for queued requests to drain or restart Ollama. "
                f"Error: {type(e).__name__}: {e}"
            )
        else:
            _last_think_failure = "error"
            logger.warning(f"_local_think unavailable ({_effective_model}): {type(e).__name__}: {e}")
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
            return _f.read()[:max_chars]
    except Exception:
        return ""


def _local_chat(messages: list[dict], model: str | None = None,
                max_tokens: int = 4096, temperature: float = 0.2) -> str | None:
    """Call Ollama /api/chat with messages array (OpenAI-compatible multi-turn format).

    Model sees prior outputs as assistant turns — better coherence for multi-stage synthesis.
    """
    import urllib.request
    _m = model or _REASONING_MODEL
    active_lock = (_gpu0_lock if _m == _LOCAL_MODEL
                   else _gpu1_lock if _m == _REASONING_MODEL
                   else _ollama_lock)
    payload = {
        "model": _m, "messages": messages, "stream": False,
        "keep_alive": _KEEP_ALIVE,
        "options": {"temperature": temperature, "num_predict": max_tokens, "num_ctx": _num_ctx_for(_m)},
    }
    body = json.dumps(payload).encode()
    req = urllib.request.Request(_LOCAL_CHAT_URL, data=body, headers={"Content-Type": "application/json"})
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
            _reasoning_markers = [
                "but note:", "however,", "let's look", "we are to", "given the above",
                "so we", "but we don't know", "we have to", "let's consider",
                "we need to find", "we can assume", "first, note that",
                "now, let's", "let's structure",
            ]
            reasoning_hits = sum(1 for m in _reasoning_markers if m in text.lower())
            if reasoning_hits >= 3 and len(text) > 200:
                for marker in ["therefore,", "so the answer", "in summary", "answer:", "file:", "pair:"]:
                    idx = text.lower().rfind(marker)
                    if idx != -1:
                        text = text[idx:].strip()
                        break
            return text if text else None
    except Exception as e:
        logger.warning(f"_local_chat unavailable ({_m}): {type(e).__name__}: {e}")
        return None


def _local_think_with_system(prompt: str, system: str, max_tokens: int = 1024,
                              model: str | None = None) -> str | None:
    """Call local Ollama model with an explicit system prompt (rarely used, no warm ctx)."""
    import urllib.request
    _m = model or _LOCAL_MODEL
    body = json.dumps({
        "model": _m, "system": system, "prompt": prompt, "stream": False,
        "keep_alive": _KEEP_ALIVE,
        "options": {"temperature": 0.3, "num_predict": max_tokens, "num_ctx": _num_ctx_for(_m)},
    }).encode()
    req = urllib.request.Request(_LOCAL_URL, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            result = json.loads(resp.read())
            text = re.sub(r'[^\x00-\x7F]+', '', result.get("response", "").strip()).strip()
            return text if text else None
    except Exception as e:
        logger.warning(f"_local_think_with_system unavailable ({_m}): {type(e).__name__}: {e}")
        return None


def compress_for_claude(text: str, max_chars: int = 600, hint: str = "") -> str:
    """Compress verbose tool output via arbiter before returning to Claude's context window.

    Preserves: file paths (src/...), signal field names, module names, numbers, action verbs.
    Strips: prose preamble, redundant explanation, verbose 'why' sections.
    Falls back to truncation if arbiter unavailable or too slow.
    """
    if len(text) <= max_chars:
        return text
    import urllib.request
    from .synthesis_warm import _warm_ctx, _warm_ctx_kb_ver
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
        "keep_alive": _KEEP_ALIVE,
        "options": {"temperature": 0.0, "num_predict": max(200, max_chars // 2), "num_ctx": _NUM_CTX_4B},
    }
    arbiter_ctx = _warm_ctx.get(_ARBITER_MODEL)
    if arbiter_ctx and _warm_ctx_kb_ver.get(_ARBITER_MODEL) == getattr(ctx, "_kb_version", 0):
        payload["context"] = arbiter_ctx
    body = json.dumps(payload).encode()
    req = urllib.request.Request(_LOCAL_URL, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            compressed = result.get("response", "").strip()
            if "</think>" in compressed:
                compressed = compressed[compressed.rfind("</think>") + len("</think>"):].strip()
            compressed = re.sub(r'[^\x00-\x7F]+', '', compressed).strip()
            if compressed and len(compressed) < len(text):
                logger.debug(f"compress_for_claude: {len(text)} → {len(compressed)} chars")
                if len(compressed) > max_chars:
                    return compressed[:max_chars] + f"…(+{len(compressed) - max_chars} chars)"
                return compressed
    except Exception as e:
        logger.debug(f"compress_for_claude: arbiter unavailable ({e}), falling back to truncation")
    return text[:max_chars] + f"…(+{len(text) - max_chars} chars)"
