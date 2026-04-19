"""HME llama.cpp synthesis layer — local model inference, priority queue, compress_for_claude.

All local inference routes through llama-server (Vulkan) instances managed by
the llamacpp_daemon + supervisor:
  arbiter → 127.0.0.1:8080 (phi-4 + HME v6 LoRA, Vulkan1/GPU0)
  coder   → 127.0.0.1:8081 (qwen3-coder:30b, Vulkan2/GPU1)

Requests use llama-server's OpenAI-compatible /v1/chat/completions shape.
Each model owns its GPU end-to-end — partial offload is a hard invariant
violation enforced by llamacpp_daemon._check_gpu_fits.
"""
import json
import os
import re
import logging
import threading as _threading

from server import context as ctx
from .synthesis_config import _THINK_SYSTEM

logger = logging.getLogger("HME")

# Backward-compat: callers in workflow.py, evolution_admin.py, reasoning_think.py
# check these to skip synthesis when llama.cpp is down. Updated by circuit breaker state.
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
                except Exception as _err1:
                    logger.debug(f"_ops.record_circuit_breaker_flap: {type(_err1).__name__}: {_err1}")
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
                except Exception as _err2:
                    logger.debug(f"_ops.record_circuit_breaker_trip: {type(_err2).__name__}: {_err2}")


_circuit_breakers: dict[str, _CircuitBreaker] = {}


def _get_circuit_breaker(model: str) -> _CircuitBreaker:
    if model not in _circuit_breakers:
        _circuit_breakers[model] = _CircuitBreaker(model)
    return _circuit_breakers[model]


# All routing config comes from the central .env loader. No defaults.
# See tools/HME/mcp/hme_env.py — fail-fast if any key is missing.
import sys as _sys
_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _mcp_root not in _sys.path:
    _sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402

_LOCAL_MODEL = ENV.require("HME_CODER_MODEL")
# Reasoning model: kept as local fallback only. Cloud cascade in synthesis_reasoning.py
# handles all live reasoning calls.
_REASONING_MODEL = ENV.require("HME_REASONING_MODEL")
# Arbiter model: phi-4 + HME v6 LoRA served by llama-server on Vulkan1 (GPU0).
_ARBITER_MODEL = ENV.require("HME_ARBITER_MODEL")


def _refresh_arbiter() -> None:
    """Reload .env so routing constants reflect any in-session .env edits.
    Kept as a thin wrapper around ENV.load(force=True) for call-site
    backwards compatibility — the module-level constants themselves are
    re-bound from the refreshed ENV."""
    global _ARBITER_MODEL, _LLAMACPP_ARBITER_URL, _LLAMACPP_CODER_URL
    global _LOCAL_MODEL, _REASONING_MODEL
    ENV.load(force=True)
    _ARBITER_MODEL = ENV.require("HME_ARBITER_MODEL")
    _LLAMACPP_ARBITER_URL = ENV.require("HME_LLAMACPP_ARBITER_URL")
    _LLAMACPP_CODER_URL = ENV.require("HME_LLAMACPP_CODER_URL")
    _LOCAL_MODEL = ENV.require("HME_CODER_MODEL")
    _REASONING_MODEL = ENV.require("HME_REASONING_MODEL")

# keep_alive=-1: pin models permanently. num_ctx sized to fit KV cache in VRAM.
# 30B Q4_K_M on M40 24GB: model weights ~18.5GB, KV ~69KB/token.
# At 32K ctx: KV ≈ 2.2GB, total ≈ 20.7GB, leaving ~1.8GB headroom.
# At 65K ctx: KV ≈ 4.3GB, total ≈ 22.8GB — overflows VRAM, KV spills to RAM,
# inference drops to ~0.02 tok/s (114s for 2 tokens). Never exceed VRAM.
_KEEP_ALIVE = ENV.require_int("HME_KEEP_ALIVE")
_NUM_CTX_30B = ENV.require_int("HME_NUM_CTX_30B")
_NUM_CTX_4B  = ENV.require_int("HME_NUM_CTX_4B")

def _num_ctx_for(model: str) -> int:
    _refresh_arbiter()
    return _NUM_CTX_4B if model == _ARBITER_MODEL else _NUM_CTX_30B

# llama-server (Vulkan) routing
# Two llama-server instances, each owning its GPU end-to-end. Both expose
# OpenAI-compatible /v1/chat/completions. llamacpp_daemon enforces the
# full-offload invariant at spawn time.
_LLAMACPP_ARBITER_URL = ENV.require("HME_LLAMACPP_ARBITER_URL")
_LLAMACPP_CODER_URL   = ENV.require("HME_LLAMACPP_CODER_URL")

_DAEMON_PORT = ENV.require_int("HME_LLAMACPP_DAEMON_PORT")
_DAEMON_URL = f"http://127.0.0.1:{_DAEMON_PORT}/generate"


def _llamacpp_url_for(model: str) -> str:
    """Map a model name to its llama-server base URL."""
    _refresh_arbiter()
    if model == _ARBITER_MODEL:
        return _LLAMACPP_ARBITER_URL
    # Everything else (coder, reasoner local fallback) goes to the coder instance.
    return _LLAMACPP_CODER_URL


_PRIORITY_MAP = {
    "critical": 5,    # request_coordinator.CRITICAL
    "interactive": 4, # request_coordinator.INTERACTIVE
    "parallel": 3,    # request_coordinator.PARALLEL
    "bulk": 2,        # request_coordinator.BULK
    "background": 1,  # request_coordinator.BACKGROUND
}


def _llamacpp_generate(payload: dict, wall_timeout: float = 30.0,
                       priority: str = "interactive") -> dict | None:
    """Route synthesis through the llama.cpp daemon.

    Historical: this function used to translate llamacpp-shape payloads into
    OpenAI chat-completions and call a dedicated request_coordinator with
    its own thread-abandon wall-clock machinery. That duplicated the daemon's
    enforcement and produced stacked timeouts (caller + coordinator + daemon)
    that let tool calls hang 3-4× longer than any single configured budget.

    Per the architectural rule "all llama.cpp timeouts live in
    llamacpp_daemon.py", we now delegate the entire call (translation,
    wall-clock enforcement, and routing) to the daemon's /generate endpoint.
    Priority is still exposed in the signature for caller-side use (arbiter
    busy flag, interactive event) but the daemon currently handles
    requests FIFO — if preemption becomes important again it must be added
    to the daemon, not re-invented at this layer.
    """
    model = payload.get("model", "")
    _is_arbiter_request = (_llamacpp_url_for(model) == _LLAMACPP_ARBITER_URL)
    try:
        if _is_arbiter_request:
            _set_arbiter_busy(True)
        return _daemon_generate(payload, wall_timeout=wall_timeout)
    finally:
        if _is_arbiter_request:
            _set_arbiter_busy(False)


_LLAMACPP_DAEMON_URL = ENV.require("HME_LLAMACPP_DAEMON_URL")

def _set_arbiter_busy(busy: bool) -> None:
    """Signal the llamacpp daemon to set/clear its arbiter-busy flag.

    The daemon uses this flag to route RAG embedding / rerank requests to
    the CPU mirror whenever the arbiter is actively using its GPU. Silently
    ignores daemon unreachability — the routing degrades to GPU-only, which
    is the pre-migration behavior and safe.
    """
    try:
        import urllib.request as _ur
        body = json.dumps({"state": "set" if busy else "clear"}).encode()
        req = _ur.Request(
            f"{_LLAMACPP_DAEMON_URL}/arbiter-busy", data=body,
            headers={"Content-Type": "application/json"},
        )
        _ur.urlopen(req, timeout=0.3).read()
    except Exception as _e:
        # Daemon unreachable is expected during boot / upgrades. Log at
        # debug level only — the routing degrades safely to GPU-only.
        import logging as _l
        _l.getLogger("HME").debug(f"arbiter-busy signal failed: {type(_e).__name__}: {_e}")


def _daemon_generate(payload: dict, wall_timeout: float = 30.0) -> dict | None:
    """Route generation through the daemon's /generate proxy.

    This is the ONE canonical path for local llama.cpp synthesis. The
    daemon is the single source of truth for wall-clock enforcement
    (see doc/HME.md — "all llama.cpp timeouts live in llamacpp_daemon.py").
    The urllib client timeout here is a trivial grace on top of the
    daemon's own wall_timeout: if the daemon is alive it will have
    already returned a {"error": "wall timeout"} JSON by then.

    Returns the llama.cpp response dict, or None if the daemon is
    unreachable or the daemon itself returned an error envelope.
    """
    import urllib.request as _ur
    payload["wall_timeout"] = wall_timeout
    body = json.dumps(payload).encode()
    req = _ur.Request(_DAEMON_URL, data=body, headers={"Content-Type": "application/json"})
    # +2s grace so the daemon's own wall_timeout is always the thing that
    # fires first. If the daemon is dead the socket will fail fast anyway.
    _http_timeout = wall_timeout + 2
    try:
        with _ur.urlopen(req, timeout=_http_timeout) as resp:
            result = json.loads(resp.read())
            if "error" in result:
                logger.warning(f"daemon /generate: {result['error']}")
                return None
            return result
    except Exception as e:
        logger.info(f"daemon /generate: {type(e).__name__} (timeout={_http_timeout}s)")
        return None

# Intelligent model routing
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


# llama.cpp priority
# _interactive_event: set by interactive callers. Background checks this flag and
# yields (before sending) or cancels mid-stream (via socket timeout in _cancellable_urlopen).
# No Python locks — llama.cpp handles its own per-model FIFO queue.
_interactive_event = _threading.Event()


def _background_yield():
    """Yield to interactive calls before each background llama.cpp request."""
    while _interactive_event.is_set():
        import time as _t
        _t.sleep(0.5)
