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
                # Layer 21: flap = probe fired but failed immediately → distinct from cold OPEN
                try:
                    from server import operational_state as _ops
                    _ops.record_circuit_breaker_flap(self.name)
                except Exception:
                    pass
            elif len(self._failures) >= self._failure_threshold:
                self._state = self.OPEN
                self._opened_at = now
                logger.warning(
                    f"CircuitBreaker({self.name}): CLOSED → OPEN "
                    f"({len(self._failures)} failures in {self._failure_window_s}s)"
                )
                # Layer 2: persist trip in operational state (survives MCP restarts)
                try:
                    from server import operational_state as _ops
                    _ops.record_circuit_breaker_trip(self.name)
                except Exception:
                    pass


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

# ── Intelligent model routing ──────────────────────────────────────────────
_CODE_SIGNALS = {"function", "implementation", "code", "callers", "logic",
                 "algorithm", "pattern", "method", "class", "module", "import",
                 "variable", "constant", "return", "parameter", "signature",
                 "source", "snippet", "syntax", "definition"}
_REASON_SIGNALS = {"why", "design", "architecture", "relationship", "trade-off",
                   "decision", "compare", "difference", "purpose", "motivation",
                   "constraint", "boundary", "coupling", "coherence", "explain",
                   "pros", "cons", "should", "strategy"}


def route_model(prompt: str) -> str:
    """Pick coder vs reasoner based on query intent. Returns model name.

    Callers that currently hardcode model= can use this instead for adaptive routing.
    Code-focused queries → _LOCAL_MODEL (coder, GPU0).
    Architecture/reasoning queries → _REASONING_MODEL (reasoner, GPU1).
    """
    words = set(prompt.lower().split())
    code_score = len(words & _CODE_SIGNALS)
    reason_score = len(words & _REASON_SIGNALS)
    if reason_score > code_score:
        return _REASONING_MODEL
    if code_score > reason_score:
        return _LOCAL_MODEL
    return _REASONING_MODEL  # default: reasoner for ambiguous queries


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
    _cb = _get_circuit_breaker(_m)
    if not _cb.allow():
        logger.warning(f"_local_chat REFUSED — circuit breaker OPEN for {_m}")
        return None
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
            _cb.record_success()
            return text if text else None
    except Exception as e:
        _cb.record_failure(is_timeout="timed out" in str(e).lower())
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
    _cb = _get_circuit_breaker(_m)
    if not _cb.allow():
        logger.warning(f"_local_think_with_system REFUSED — circuit breaker OPEN for {_m}")
        return None
    body = json.dumps({
        "model": _m, "system": system, "prompt": prompt, "stream": False,
        "keep_alive": _KEEP_ALIVE,
        "options": {"temperature": 0.3, "num_predict": max_tokens, "num_ctx": _num_ctx_for(_m)},
    }).encode()
    req = urllib.request.Request(_url_for(_m), data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
            text = result.get("response", "").strip()
            if not text:
                text = result.get("thinking", "").strip()
            if "</think>" in text:
                text = text[text.rfind("</think>") + len("</think>"):].strip()
            text = re.sub(r'[^\x00-\x7F]+', '', text).strip()
            _cb.record_success()
            return text if text else None
    except Exception as e:
        _cb.record_failure(is_timeout="timed out" in str(e).lower())
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
    _cb = _get_circuit_breaker(_ARBITER_MODEL)
    if not _cb.allow():
        return text[:max_chars] + f"…(+{len(text) - max_chars} chars)"
    body = json.dumps(payload).encode()
    req = urllib.request.Request(_url_for(_ARBITER_MODEL), data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            compressed = result.get("response", "").strip()
            if "</think>" in compressed:
                compressed = compressed[compressed.rfind("</think>") + len("</think>"):].strip()
            compressed = re.sub(r'[^\x00-\x7F]+', '', compressed).strip()
            _cb.record_success()
            if compressed and len(compressed) < len(text):
                logger.debug(f"compress_for_claude: {len(text)} → {len(compressed)} chars")
                if len(compressed) > max_chars:
                    return compressed[:max_chars] + f"…(+{len(compressed) - max_chars} chars)"
                return compressed
    except Exception as e:
        _cb.record_failure(is_timeout="timed out" in str(e).lower())
        logger.debug(f"compress_for_claude: arbiter unavailable ({e}), falling back to truncation")
    return text[:max_chars] + f"…(+{len(text) - max_chars} chars)"


# ── Adaptive multi-stage synthesis ────────────────────────────────────────
# synthesize() auto-detects complexity, injects context, routes to optimal
# strategy, and quality-gates output. Strategies:
#   direct (1):   route_model() → single call (fast)
#   enriched (2): source grounding + best model (balanced)
#   cascade (3):  arbiter plan → coder kickstart → reasoner deep (thorough)

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


def _assess_complexity(prompt: str) -> dict:
    """Score prompt complexity 1-3 via two-tier heuristic. No model call — zero latency.

    Deep signals (architecture, coupling, feedback) score 1.0 each.
    Moderate signals (detect, trace, flow) score 0.5 each.
    Mentioning specific modules (camelCase) adds 0.5 bonus.
    Score >= 3.0 → cascade, >= 1.5 → enriched, else direct.
    """
    words_lower = prompt.lower()

    if any(s in words_lower for s in _SIMPLE_SIGNALS):
        return {"complexity": 1, "strategy": "direct", "reasoning": "simple"}

    deep = sum(1 for s in _DEEP_SIGNALS if s in words_lower)
    mod = sum(1 for s in _MOD_SIGNALS if s in words_lower)
    modules = re.findall(r'\b[a-z]+(?:[A-Z][a-z]+)+\b', prompt)
    score = deep + mod * 0.5 + (0.5 if modules else 0)

    if score < 0.5 and len(prompt) < 150:
        return {"complexity": 1, "strategy": "direct", "reasoning": "short, no signals"}
    if score >= 3.0:
        return {"complexity": 3, "strategy": "cascade", "reasoning": f"score={score:.1f}"}
    if score >= 1.5 or len(prompt) > 300:
        return {"complexity": 2, "strategy": "enriched", "reasoning": f"score={score:.1f}"}
    return {"complexity": 1, "strategy": "direct", "reasoning": f"score={score:.1f}"}


def _camel_acronym(name: str) -> str:
    """Compute first-letter acronym of a camelCase name.
    coordinationIndependenceManager → 'cim'
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
    root = getattr(ctx, "PROJECT_ROOT", os.environ.get("POLYCHRON_ROOT", ""))
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

    Session narrative is NOT added here — _local_think handles that separately.
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
        if ops.get("shim_crashes_today", 0) > 0:
            alerts.append(f"shim_crashes={ops['shim_crashes_today']}")
        if ops.get("recovery_success_rate_ema", 1.0) < 0.8:
            alerts.append(f"recovery={ops['recovery_success_rate_ema']:.0%}")
        if alerts:
            parts.append(f"[Health: {', '.join(alerts)}]")
    except Exception:
        pass

    return "\n".join(parts) + "\n\n" + prompt if parts else prompt


def _cascade_synthesis(prompt: str, enriched_prompt: str,
                       max_tokens: int = 8192) -> str | None:
    """Three-stage: arbiter plan → coder kickstart → reasoner deep synthesis.

    The coder provides verified structural facts (file paths, function names,
    signal fields). The reasoner uses those as grounded context for deep analysis,
    preventing hallucinated module names while enabling rich architectural reasoning.

    Grounding chain (all three must provide at least one source):
    1. Pre-discovery: fuzzy module search → source in enriched_prompt
    2. Arbiter plan: given module registry → names real modules → source injection
    3. Stage 2 coder: receives BOTH pre-discovered AND plan-derived sources
    """
    from .synthesis_config import _THINK_SYSTEM

    # Extract pre-discovered sources already in enriched_prompt (from _inject_context)
    # These exist even when prompt has no camelCase module names (fuzzy discovery ran).
    _pre_sources = re.findall(r'\[Source: \w+\]\n[\s\S]*?(?=\[Source:|\[Health:|\Z)', enriched_prompt)
    _pre_source_block = "\n".join(_pre_sources[:2])[:3000]

    # Build arbiter module registry: fuzzy-find relevant modules so arbiter can name them
    _registry_mods = _fuzzy_find_modules(prompt, max_results=12)
    _registry_hint = (
        f"\nKnown project modules (use exact names): {', '.join(_registry_mods)}"
        if _registry_mods else ""
    )

    # Stage 1: Arbiter plans the investigation — context-aware via module registry
    plan = _local_think_with_system(
        f"Break into 3-5 investigation steps:\n\n{prompt[:400]}"
        f"{_registry_hint}\n\n"
        "Each step: WHAT (exact module name from list above), WHERE (subsystem), WHY (relevance).",
        "Code investigation planner. Use exact module names from the list. Concrete steps only.",
        500, _ARBITER_MODEL,
    )
    if plan and "</think>" in plan:
        plan = plan[plan.rfind("</think>") + len("</think>"):].strip()
    if not plan or len(plan) < 30:
        logger.info("cascade: arbiter plan failed, enriched fallback")
        return _local_think(enriched_prompt, max_tokens=max_tokens,
                           model=_REASONING_MODEL, system=_THINK_SYSTEM)

    # Source injection from arbiter plan: any new camelCase names the plan introduced
    _plan_modules = re.findall(r'\b[a-z]+(?:[A-Z][a-z]+)+\b', plan)
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

    # Stage 2: Coder kickstart — structured fact extraction grounded in source
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
        logger.info("cascade: coder failed, reasoner with plan")
        return _local_think(
            f"Plan:\n{plan}\n\n{enriched_prompt}",
            max_tokens=max_tokens, model=_REASONING_MODEL, system=_THINK_SYSTEM,
        )

    # Stage 3: Reasoner deep synthesis using coder's verified facts
    result = _local_think(
        f"Question: {prompt[:300]}\n\n"
        f"VERIFIED FACTS (trust these paths/names):\n{coder_out}\n\n"
        "Synthesize: module interactions, architectural implications, recommendations.\n"
        "Use ONLY names from verified facts. Max 600 words.",
        max_tokens=max_tokens, model=_REASONING_MODEL,
        system=_THINK_SYSTEM, temperature=0.2,
    )
    if result:
        logger.info(
            f"cascade: arbiter({len(plan)}c)→coder({len(coder_out)}c)→reasoner({len(result)}c)"
        )
        result += (
            f"\n\n*cascade: arbiter({len(plan)}c)"
            f"→coder({len(coder_out)}c)→reasoner({len(result)}c)*"
        )
    return result


def dual_gpu_consensus(prompt: str, max_tokens: int = 4096) -> str | None:
    """Fire both GPUs in parallel on the same prompt. Arbiter picks the best.

    Coder and reasoner analyze independently — if they agree, high confidence.
    If they disagree, the disagreement itself is a valuable finding.
    """
    from .synthesis_config import _THINK_SYSTEM

    results = [None, None]

    def _g0():
        results[0] = _local_think(prompt, max_tokens=max_tokens, model=_LOCAL_MODEL,
                                   system=_THINK_SYSTEM, temperature=0.15, priority="parallel")

    def _g1():
        results[1] = _local_think(prompt, max_tokens=max_tokens, model=_REASONING_MODEL,
                                   system=_THINK_SYSTEM, temperature=0.2, priority="parallel")

    t0 = _threading.Thread(target=_g0, daemon=True)
    t1 = _threading.Thread(target=_g1, daemon=True)
    t0.start(); t1.start()
    t0.join(timeout=120); t1.join(timeout=120)

    g0, g1 = results[0], results[1]
    if not g0 and not g1:
        return None
    if not g0:
        return g1
    if not g1:
        return g0

    # Both succeeded — arbiter picks winner
    pick = _local_think_with_system(
        f"Two analyses of: {prompt[:150]}\n\n"
        f"A (coder):\n{g0[:600]}\n\nB (reasoner):\n{g1[:600]}\n\n"
        "Which is better? Respond: A or B, then one sentence why.",
        "Pick A or B. Default B if equal.", 80, _ARBITER_MODEL,
    )
    picked_a = False
    if pick:
        if "</think>" in pick:
            pick = pick[pick.rfind("</think>") + len("</think>"):].strip()
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

    Zero latency — no model call. Extracts camelCase module references, verifies
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
        return f"[unverified — {phantom} refs unresolved] {output}", phantom, verified
    return output, phantom, verified


def synthesize(prompt: str, max_tokens: int = 8192, priority: str = "interactive",
               auto_context: bool = True, quality_check: bool = True) -> str | None:
    """Adaptive multi-stage synthesis — highest-quality inference path in HME.

    1. Assesses complexity (arbiter scores 1-3)
    2. Injects source grounding + operational context
    3. Routes: direct (1) / enriched (2) / cascade (3)
    4. Quality-gates output via arbiter
    5. Auto-escalates strategy on failure (direct→enriched→cascade)
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

    # Auto-escalate on failure: try alt GPU with enriched context → cascade
    if not result and strategy != "cascade":
        enriched = _inject_context(prompt) if auto_context else prompt
        alt = _REASONING_MODEL if route_model(prompt) == _LOCAL_MODEL else _LOCAL_MODEL
        result = _local_think(enriched, max_tokens=max_tokens, model=alt,
                             system=_THINK_SYSTEM, priority=priority)
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
    except Exception:
        pass

    from .synthesis_session import append_session_narrative
    append_session_narrative(
        "think", f"synthesize({strategy},c={complexity}): {prompt[:50]}→{len(result)}c"
    )

    return result
