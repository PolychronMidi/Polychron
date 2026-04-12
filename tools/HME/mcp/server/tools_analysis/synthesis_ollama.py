"""HME Ollama synthesis layer — local model inference, priority queue, compress_for_claude."""
import json
import os
import re
import logging
import threading as _threading

from server import context as ctx
from .synthesis_config import _THINK_SYSTEM

logger = logging.getLogger("HME")

# Backward-compat: callers in workflow.py, evolution_admin.py, reasoning_think.py
# check these to skip synthesis when Ollama is down. Updated by circuit breaker state.
_last_think_failure: str | None = None
_last_think_failure_ts: float = 0.0
_TIMEOUT_COOLDOWN_S = 15  # matches circuit breaker recovery_s

# Sentinel to distinguish cooldown refusal from background timeout in return values.
_COOLDOWN_REFUSED = "cooldown_refused"


class _CircuitBreaker:
    """3-state circuit breaker: CLOSED → OPEN (after failures) → HALF_OPEN (probe) → CLOSED."""
    CLOSED, OPEN, HALF_OPEN = "CLOSED", "OPEN", "HALF_OPEN"

    def __init__(self, name: str, failure_threshold: int = 3,
                 failure_window_s: float = 60.0, recovery_s: float = 15.0):
        self.name = name
        self._failure_threshold = failure_threshold
        self._failure_window_s = failure_window_s
        self._recovery_s = recovery_s
        self._state = self.CLOSED
        self._failures: list[float] = []
        self._opened_at: float = 0.0
        self._lock = _threading.Lock()

    @property
    def state(self) -> str:
        with self._lock:
            if self._state == self.OPEN:
                import time as _t
                if _t.monotonic() - self._opened_at >= self._recovery_s:
                    self._state = self.HALF_OPEN
                    logger.info(f"CircuitBreaker({self.name}): OPEN → HALF_OPEN (probe allowed)")
            return self._state

    def allow(self) -> bool:
        s = self.state
        if s == self.CLOSED:
            return True
        if s == self.HALF_OPEN:
            return True
        return False

    def record_success(self):
        global _last_think_failure
        with self._lock:
            if self._state == self.HALF_OPEN:
                logger.info(f"CircuitBreaker({self.name}): HALF_OPEN → CLOSED (probe succeeded)")
            self._state = self.CLOSED
            self._failures.clear()
            _last_think_failure = None

    def record_failure(self, is_timeout: bool = False):
        import time as _t
        global _last_think_failure, _last_think_failure_ts
        with self._lock:
            now = _t.monotonic()
            self._failures = [t for t in self._failures if now - t < self._failure_window_s]
            self._failures.append(now)
            if is_timeout:
                _last_think_failure = "timeout"
                _last_think_failure_ts = now
            else:
                _last_think_failure = "error"
            if self._state == self.HALF_OPEN:
                self._state = self.OPEN
                self._opened_at = now
                logger.info(f"CircuitBreaker({self.name}): HALF_OPEN → OPEN (probe failed)")
            elif len(self._failures) >= self._failure_threshold:
                self._state = self.OPEN
                self._opened_at = now
                logger.warning(
                    f"CircuitBreaker({self.name}): CLOSED → OPEN "
                    f"({len(self._failures)} failures in {self._failure_window_s}s)"
                )


_circuit_breakers: dict[str, _CircuitBreaker] = {}


def _get_circuit_breaker(model: str) -> _CircuitBreaker:
    if model not in _circuit_breakers:
        _circuit_breakers[model] = _CircuitBreaker(model)
    return _circuit_breakers[model]


_LOCAL_MODEL = os.environ.get("HME_LOCAL_MODEL", "qwen3-coder:30b")
# Reasoning model: Qwen3-30B-A3B (MoE, 3B active params, hybrid thinking mode).
# Beats QwQ-32B and DeepSeek-R1 on reasoning benchmarks at lower compute.
# ~18.6GB Q4 — fits on one M40.
_REASONING_MODEL = os.environ.get("HME_REASONING_MODEL", "qwen3:30b-a3b")
# Arbiter model: Qwen3 4B (~2.5GB Q4) — runs during GPU idle between Stage 1 and Stage 2.
# Ollama auto-schedules GPU layers; falls back to CPU/RAM (64GB) when GPUs are busy.
_ARBITER_MODEL = os.environ.get("HME_ARBITER_MODEL", "qwen3:4b")

# keep_alive=-1: pin models permanently. num_ctx sized to fit KV cache in VRAM.
# 30B Q4_K_M on M40 24GB: model weights ~18.5GB, KV ~69KB/token.
# At 32K ctx: KV ≈ 2.2GB, total ≈ 20.7GB, leaving ~1.8GB headroom.
# At 65K ctx: KV ≈ 4.3GB, total ≈ 22.8GB — overflows VRAM, KV spills to RAM,
# inference drops to ~0.02 tok/s (114s for 2 tokens). Never exceed VRAM.
_KEEP_ALIVE = int(os.environ.get("HME_KEEP_ALIVE", "-1"))
_NUM_CTX_30B = int(os.environ.get("HME_NUM_CTX_30B", "32768"))
_NUM_CTX_4B  = int(os.environ.get("HME_NUM_CTX_4B",  "32768"))

def _num_ctx_for(model: str) -> int:
    return _NUM_CTX_4B if model == _ARBITER_MODEL else _NUM_CTX_30B

# ── Per-model Ollama instance routing ──────────────────────────────────────
# 3 isolated Ollama instances: GPU0 (:11434), GPU1 (:11435), CPU (:11436).
# Each instance sees only its assigned device via CUDA_VISIBLE_DEVICES.
_OLLAMA_PORT_GPU0 = int(os.environ.get("HME_OLLAMA_PORT_GPU0", "11434"))
_OLLAMA_PORT_GPU1 = int(os.environ.get("HME_OLLAMA_PORT_GPU1", "11435"))
_OLLAMA_PORT_CPU  = int(os.environ.get("HME_OLLAMA_PORT_CPU",  "11436"))

def _url_for(model: str, endpoint: str = "generate") -> str:
    """Route model to its dedicated Ollama instance."""
    if model == _LOCAL_MODEL:
        port = _OLLAMA_PORT_GPU0
    elif model == _REASONING_MODEL:
        port = _OLLAMA_PORT_GPU1
    else:
        port = _OLLAMA_PORT_CPU
    return f"http://localhost:{port}/api/{endpoint}"

# Legacy compat — used by callers that don't pass model
_LOCAL_URL = f"http://localhost:{_OLLAMA_PORT_GPU0}/api/generate"
_LOCAL_CHAT_URL = f"http://localhost:{_OLLAMA_PORT_GPU0}/api/chat"


# ── Ollama priority ────────────────────────────────────────────────────────
# _ollama_interactive: set by interactive callers. Background checks this flag and
# yields (before sending) or cancels mid-stream (via socket timeout in _cancellable_urlopen).
# No Python locks — Ollama handles its own per-model FIFO queue.
_ollama_interactive = _threading.Event()


def _ollama_background_yield():
    """Yield to interactive calls before each background Ollama request."""
    while _ollama_interactive.is_set():
        import time as _t
        _t.sleep(0.5)


def _cancellable_urlopen(req_data, url, timeout, cancel_event):
    """Streaming urlopen that aborts when cancel_event fires.

    Full timeout for initial urlopen (Ollama queues requests and won't send headers
    until it starts processing ours). Then 2s socket timeout for reads so cancel_event
    is checked every 2s during prompt eval. Returns (response_bytes, None) or (None, exception).
    """
    import urllib.request
    payload = json.loads(req_data)
    payload["stream"] = True
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except Exception as e:
        return None, e
    try:
        resp.fp.raw._sock.settimeout(2.0)
    except (AttributeError, Exception):
        logger.debug("_cancellable_urlopen: could not set 2s socket timeout — cancel detection may be slow")
    try:
        chunks = []
        final_result = {}
        deadline = __import__("time").time() + timeout
        while True:
            if cancel_event.is_set():
                break
            if __import__("time").time() > deadline:
                resp.close()
                return None, TimeoutError(f"timed out after {timeout}s")
            try:
                raw_line = next(resp)
            except OSError as _sock_err:
                if cancel_event.is_set():
                    break
                if isinstance(_sock_err, TimeoutError):
                    continue
                raise
            except StopIteration:
                break
            except Exception as e:
                if cancel_event.is_set():
                    break
                raise
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line:
                continue
            chunk = json.loads(line)
            text_piece = chunk.get("response", "")
            if text_piece:
                chunks.append(text_piece)
            if chunk.get("done"):
                final_result = chunk
                break
        if cancel_event.is_set():
            try:
                resp.close()
            except Exception:
                pass
            logger.info("_cancellable_urlopen: cancelled in %.1fs", __import__("time").time() - (deadline - timeout))
            return None, InterruptedError("cancelled by interactive call")
        final_result["response"] = "".join(chunks)
        return json.dumps(final_result).encode(), None
    except Exception as e:
        if cancel_event.is_set():
            return None, InterruptedError("cancelled by interactive call")
        try:
            resp.close()
        except Exception:
            pass
        return None, e


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

    _effective_model_early = model or _LOCAL_MODEL
    _cb = _get_circuit_breaker(_effective_model_early)
    if not _cb.allow():
        if priority != "background":
            logger.warning(f"_local_think REFUSED — circuit breaker OPEN for {_effective_model_early}")
        return (_COOLDOWN_REFUSED, []) if return_context else None

    # "parallel" = two threads hitting different GPUs simultaneously. Treated like
    # interactive (no yielding, uses interactive timeout) but does NOT set the
    # interactive preemption flag (which would block the sibling parallel thread).
    if priority == "background":
        _ollama_background_yield()
    elif priority == "interactive":
        _ollama_interactive.set()

    _effective_model = model or _LOCAL_MODEL

    # Lazy warm: kick off background priming on first interactive/parallel call
    if priority in ("interactive", "parallel") and system == _THINK_SYSTEM:
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

    # Inject session narrative — filtered by relevance to the call type.
    if priority != "background" and (system == _THINK_SYSTEM or (system == "" and context is not None)):
        from .synthesis_session import get_session_narrative
        _narrative_cats = ["think", "edit", "search"] if "callers" in prompt.lower() or "find" in prompt.lower() else None
        narrative = get_session_narrative(max_entries=5, categories=_narrative_cats)
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
        _url_for(_effective_model), data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        if priority == "background":
            _ollama_background_yield()
            raw_bytes, cancel_err = _cancellable_urlopen(body, _url_for(_effective_model), timeout=120, cancel_event=_ollama_interactive)
            if cancel_err:
                if isinstance(cancel_err, InterruptedError):
                    return (None, []) if return_context else None
                raise cancel_err
        else:
            # Reasoning model needs more headroom — 30B MoE cold call (prompt eval + generation)
            # can exceed 60s when warm KV context is stale. Local model stays at 60s.
            _interact_timeout = 120 if _effective_model == _REASONING_MODEL else 60
            with urllib.request.urlopen(req, timeout=_interact_timeout) as resp:
                raw_bytes = resp.read()
        if priority == "interactive":
            _ollama_interactive.clear()
        result = json.loads(raw_bytes)
        text = result.get("response", "").strip()
        # Strip markdown fenced thinking blocks (```thinking ... ``` or ```reasoning ... ```)
        text = re.sub(r'```(?:thinking|reasoning)\b[\s\S]*?```', '', text, flags=re.IGNORECASE).strip()
        # Strip ChatML system/turn tags used by Qwen and similar models
        if "<|im_start|>" in text:
            # Keep only content inside the last assistant turn, or strip all tags
            import re as _re2
            # Extract last assistant block if present
            _asst = _re2.findall(r'<\|im_start\|>assistant\s*([\s\S]*?)(?:<\|im_end\|>|$)', text, _re2.IGNORECASE)
            if _asst:
                text = _asst[-1].strip()
            else:
                text = _re2.sub(r'<\|im_start\|>[\s\S]*?<\|im_end\|>', '', text).strip()
                text = _re2.sub(r'<\|im_start\|>|<\|im_end\|>', '', text).strip()
        # Strip XML-style thinking tags (<think>, <|thinking|>, <|answer|> delimiters)
        if "<|answer|>" in text:
            text = text[text.rfind("<|answer|>") + len("<|answer|>"):].strip()
        elif "<|thinking|>" in text:
            after = text[text.rfind("<|/thinking|>") + len("<|/thinking|>"):].strip() if "<|/thinking|>" in text else ""
            before = text[:text.find("<|thinking|>")].strip()
            text = after or before or ""
        if "</think>" in text:
            text = text[text.rfind("</think>") + len("</think>"):].strip()
        elif "<think>" in text:
            before_think = text[:text.find("<think>")].strip()
            text = before_think if before_think else ""
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
            return None
        _reasoning_markers = [
            "but note:", "however,", "let's look", "we are to", "given the above",
            "so we", "but we don't know", "we have to", "let's consider",
            "we need to find", "we can assume", "first, note that",
            "let me ", "let's form", "we can list", "we don't have",
            "the problem ", "how to be specific", "we must not speculate",
            "okay,", "hmm,", "the challenge is", "double-check",
            "*final polish*", "making sure each", "should i check",
        ]
        reasoning_hits = sum(1 for m in _reasoning_markers if m in text.lower())
        if reasoning_hits >= 2 and len(text) > 400:
            for marker in ["therefore,", "so the answer", "in summary", "the next two", "answer:",
                          "the key ", "the most critical", "in conclusion", "to summarize",
                          "here's the", "the fix ", "the result"]:
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
        if not text:
            return (None, []) if return_context else None
        _cb.record_success()
        # Trim verbose output before returning — callers shouldn't receive
        # unbounded text that inflates Claude's context window.
        from . import BUDGET_LOCAL_THINK
        if len(text) > BUDGET_LOCAL_THINK:
            from . import _budget_local_think
            text = _budget_local_think(text)
        if return_context:
            return (text, result.get("context", []))
        return text
    except Exception as e:
        if priority == "interactive":
            _ollama_interactive.clear()
        _err_str = str(e).lower()
        _is_timeout = ("timed out" in _err_str or "timeout" in type(e).__name__.lower()
                       or "urlopen error" in _err_str)
        _is_critical = ("cuda" in _err_str or "500" in _err_str or "oom" in _err_str
                        or "out of memory" in _err_str or "killed" in _err_str
                        or "internal server error" in _err_str or "panic" in _err_str)
        if _is_critical:
            ctx.register_critical_failure(
                f"_local_think({_effective_model})",
                f"{type(e).__name__}: {e}",
            )
        _cb.record_failure(is_timeout=_is_timeout)
        if _is_timeout:
            if priority != "background":
                logger.warning(
                    f"_local_think TIMEOUT ({_effective_model}) — circuit breaker: {_cb.state}. "
                    f"Error: {type(e).__name__}: {e}"
                )
        elif not _is_critical:
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
    except Exception as e:
        logger.warning(f"source_context: failed to read {candidates[0]}: {e}")
        return ""


def _local_chat(messages: list[dict], model: str | None = None,
                max_tokens: int = 4096, temperature: float = 0.2) -> str | None:
    """Call Ollama /api/chat with messages array (OpenAI-compatible multi-turn format).

    Model sees prior outputs as assistant turns — better coherence for multi-stage synthesis.
    """
    import urllib.request
    _m = model or _REASONING_MODEL
    payload = {
        "model": _m, "messages": messages, "stream": False,
        "keep_alive": _KEEP_ALIVE,
        "options": {"temperature": temperature, "num_predict": max_tokens, "num_ctx": _num_ctx_for(_m)},
    }
    body = json.dumps(payload).encode()
    req = urllib.request.Request(_url_for(_m, "chat"), data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
            msg = result.get("message", {})
            text = msg.get("content", "").strip() if isinstance(msg, dict) else ""
            text = re.sub(r'```(?:thinking|reasoning)\b[\s\S]*?```', '', text, flags=re.IGNORECASE).strip()
            if "<|im_start|>" in text:
                import re as _re2c
                _asst = _re2c.findall(r'<\|im_start\|>assistant\s*([\s\S]*?)(?:<\|im_end\|>|$)', text, _re2c.IGNORECASE)
                if _asst:
                    text = _asst[-1].strip()
                else:
                    text = _re2c.sub(r'<\|im_start\|>[\s\S]*?<\|im_end\|>', '', text).strip()
            if "<|answer|>" in text:
                text = text[text.rfind("<|answer|>") + len("<|answer|>"):].strip()
            elif "<|thinking|>" in text:
                after = text[text.rfind("<|/thinking|>") + len("<|/thinking|>"):].strip() if "<|/thinking|>" in text else ""
                before = text[:text.find("<|thinking|>")].strip()
                text = after or before or ""
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
        _err_str = str(e).lower()
        if any(k in _err_str for k in ("cuda", "500", "oom", "out of memory", "killed", "internal server error", "panic")):
            ctx.register_critical_failure(f"_local_chat({_m})", f"{type(e).__name__}: {e}")
        else:
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
    req = urllib.request.Request(_url_for(_m), data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
            text = re.sub(r'[^\x00-\x7F]+', '', result.get("response", "").strip()).strip()
            return text if text else None
    except Exception as e:
        _err_str = str(e).lower()
        if any(k in _err_str for k in ("cuda", "500", "oom", "out of memory", "killed", "internal server error", "panic")):
            ctx.register_critical_failure(f"_local_think_with_system({_m})", f"{type(e).__name__}: {e}")
        else:
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
    req = urllib.request.Request(_url_for(_ARBITER_MODEL), data=body, headers={"Content-Type": "application/json"})
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
