"""llama.cpp persistence daemon — supervisor, RAG router, and health proxy.

Runs on port 7735, writes PID to /tmp/hme-llamacpp-daemon.pid.

This daemon is HME's single source of truth for local inference. It owns:

1. **llama-server supervisor** — spawn/adopt/restart the arbiter (phi-4 + v6
   LoRA on Vulkan1/GPU0) and coder (qwen3-coder-30b on Vulkan2/GPU1)
   instances. Enforces the HME architecture invariant: each model owns its
   GPU end-to-end. Full offload only (n_gpu_layers=999). Refuses to spawn and
   registers a CRITICAL LIFESAVER if a model would offload to CPU.

2. **RAG routing flag** — `GET /rag-route` answers "gpu" or "cpu" based on an
   in-memory `_arbiter_busy` flag. Arbiter request dispatch code calls
   `POST /arbiter-busy` with `{state: "set"|"clear"}` around each request.
   The shim's RAG call sites ask this daemon which backend to use, then
   dispatch to either the GPU-resident or CPU-mirror embedder/reranker.

3. **Generation proxy** — `POST /generate` translates llamacpp-shape
   `/api/generate` requests into llama-server OpenAI `/v1/chat/completions`
   calls. Wall-clock timeouts enforced per-request. This keeps legacy
   callers in HME that speak the old llamacpp shape working during migration.

4. **Health aggregation** — `GET /health` returns combined supervisor +
   instance status. Used by the MCP shim's startup probe to decide whether
   to skip its own `_init_local_models()` path.

Usage:
    python3 llamacpp_daemon.py [--port 7735]
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

# Central .env loader — fail-fast semantics. See tools/HME/mcp/hme_env.py.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hme_env import ENV  # noqa: E402

logging.basicConfig(level=logging.WARNING, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("HME.llamacpp")
logger.setLevel(logging.INFO)

PID_FILE = "/tmp/hme-llamacpp-daemon.pid"
TRAINING_LOCK = ENV.require("HME_TRAINING_LOCK")

_DEFAULT_WALL_TIMEOUT = 45  # hard wall-clock cap for /generate proxy
_HEALTH_INTERVAL = 60       # self-health-tick interval (s)


def _training_locked() -> bool:
    """Skip all auto-spawn/restart when the training lock is held."""
    return os.path.exists(TRAINING_LOCK)


# ══════════════════════════════════════════════════════════════════════════
#  InstanceSpec + Supervisor
# ══════════════════════════════════════════════════════════════════════════

@dataclass
class InstanceSpec:
    """Declarative launch plan for one llama-server instance."""
    name: str
    model_path: str
    port: int
    device: str           # Vulkan device string, e.g. "Vulkan1" / "Vulkan2"
    alias: str            # llama-server --alias (the model name clients use)
    ctx_size: int = 4096
    n_gpu_layers: int = 999   # HME invariant: full offload only
    timeout_s: int = 30
    lora_path: str | None = None
    extra_args: list[str] = field(default_factory=list)
    # Runtime state
    process: subprocess.Popen | None = None
    last_start: float = 0.0
    restart_count: int = 0
    last_health_ok: float = 0.0

    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def build_argv(self, bin_path: str) -> list[str]:
        argv = [
            bin_path,
            "--model", self.model_path,
            "--host", "127.0.0.1",
            "--port", str(self.port),
            "--ctx-size", str(self.ctx_size),
            "--n-gpu-layers", str(self.n_gpu_layers),
            "--device", self.device,
            "--alias", self.alias,
            "--timeout", str(self.timeout_s),
            "--jinja",
        ]
        if self.lora_path:
            argv.extend(["--lora", self.lora_path])
        argv.extend(self.extra_args)
        return argv


# ── Topology ─────────────────────────────────────────────────────────────
# Vulkan device indices: Vulkan0 = Intel iGPU, Vulkan1 = M40 #1 (CUDA 0),
# Vulkan2 = M40 #2 (CUDA 1). Each LLM owns its GPU end-to-end.
# ARCHITECTURE INVARIANT: n_gpu_layers is always 999 (full offload). Any
# partial-offload scenario fires a CRITICAL LIFESAVER and refuses to spawn.
def _default_instances() -> list[InstanceSpec]:
    arbiter_model = ENV.require("HME_ARBITER")
    coder_model   = ENV.require("HME_CODER")
    return [
        InstanceSpec(
            name="arbiter",
            model_path=arbiter_model,
            port=ENV.require_int("HME_ARBITER_PORT"),
            device=ENV.require("HME_ARBITER_VULKAN"),
            alias=ENV.require("HME_ARBITER_MODEL"),
            ctx_size=ENV.require_int("HME_ARBITER_CTX"),
            n_gpu_layers=999,  # invariant
        ),
        InstanceSpec(
            name="coder",
            model_path=coder_model,
            port=ENV.require_int("HME_CODER_PORT"),
            device=ENV.require("HME_CODER_VULKAN"),
            alias=ENV.require("HME_CODER_ALIAS"),
            ctx_size=ENV.require_int("HME_CODER_CTX"),
            n_gpu_layers=999,  # invariant
        ),
    ]


class _Supervisor:
    """Owns llama-server processes. Adopts externally-launched survivors,
    spawns missing ones, restarts unhealthy ones, fires LIFESAVER on failures."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._instances: dict[str, InstanceSpec] = {}
        self._bin = ENV.require("HME_LLAMA_SERVER_BIN")
        self._log_dir = ENV.require("HME_LLAMA_LOG_DIR")
        self._health_timeout_s = ENV.require_float("HME_LLAMA_HEALTH_TIMEOUT")
        self._min_restart_interval = ENV.require_float("HME_LLAMA_RESTART_COOLDOWN")

    def configure(self, instances: list[InstanceSpec] | None = None) -> None:
        instances = instances or _default_instances()
        with self._lock:
            for spec in instances:
                existing = self._instances.get(spec.name)
                if existing is None:
                    self._instances[spec.name] = spec
                else:
                    for k in ("model_path", "port", "device", "alias", "ctx_size",
                              "n_gpu_layers", "timeout_s", "lora_path"):
                        setattr(existing, k, getattr(spec, k))

    def instances(self) -> list[InstanceSpec]:
        with self._lock:
            return list(self._instances.values())

    def _probe_health(self, spec: InstanceSpec) -> bool:
        try:
            with urllib.request.urlopen(f"{spec.base_url()}/health", timeout=self._health_timeout_s) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                try:
                    data = json.loads(body)
                except ValueError:
                    data = {}
                return resp.status == 200 and data.get("status") == "ok"
        except Exception as _probe_err:
            logger.debug(f"supervisor: /health probe failed for {spec.base_url()}: {type(_probe_err).__name__}: {_probe_err}")
            return False

    # ── GPU residence invariant ──────────────────────────────────────────
    def _vulkan_to_cuda_index(self, device: str) -> int | None:
        """Vulkan1 = CUDA 0, Vulkan2 = CUDA 1. Unknown → None (invariant violation)."""
        if device == "Vulkan1":
            return 0
        if device == "Vulkan2":
            return 1
        return None

    def _gpu_free_mb(self, cuda_idx: int) -> int | None:
        try:
            out = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits", f"--id={cuda_idx}"],
                stderr=subprocess.DEVNULL,
                timeout=3,
            )
            return int(out.decode().strip().splitlines()[0])
        except Exception as _gpu_err:
            logger.warning(f"supervisor: nvidia-smi probe failed for cuda:{cuda_idx}: {_gpu_err}")
            return None

    def _check_gpu_fits(self, spec: InstanceSpec) -> tuple[bool, str]:
        """Return (True, '') if model + KV cache fits in assigned GPU's free VRAM
        with headroom, else (False, reason). Conservative: model file size
        plus ctx_size * 0.5 MB KV budget plus 1024 MB headroom."""
        cuda_idx = self._vulkan_to_cuda_index(spec.device)
        if cuda_idx is None:
            return False, f"unknown Vulkan device {spec.device!r} — cannot guarantee full offload"

        free_mb = self._gpu_free_mb(cuda_idx)
        if free_mb is None:
            return False, f"could not probe free VRAM on cuda:{cuda_idx} ({spec.device})"

        try:
            model_mb = os.path.getsize(spec.model_path) // (1024 * 1024)
        except OSError as _stat_err:
            return False, f"could not stat model file: {_stat_err}"

        kv_mb = (spec.ctx_size * 512) // 1024
        headroom_mb = 1024
        needed_mb = model_mb + kv_mb + headroom_mb

        if needed_mb > free_mb:
            return False, (
                f"won't fit on {spec.device} (cuda:{cuda_idx}): "
                f"need {needed_mb} MB (model {model_mb} + kv {kv_mb} + headroom {headroom_mb}), "
                f"only {free_mb} MB free"
            )
        return True, ""

    def _fire_offload_violation(self, spec: InstanceSpec, reason: str) -> None:
        """ARCHITECTURE INVARIANT VIOLATION: model would offload to CPU.

        Each model owns its GPU end-to-end. Partial offload is a hard failure
        — never a graceful degradation. Refuses spawn and registers a CRITICAL
        LIFESAVER so the operator knows to free the assigned GPU.
        """
        msg = (
            f"GPU offload invariant violated: {spec.name} ({os.path.basename(spec.model_path)}) "
            f"on {spec.device} — {reason}. "
            f"Each HME model OWNS its GPU. Free the assigned device and restart the daemon."
        )
        logger.error(f"supervisor: {msg}")
        # Try to reach the shim's LIFESAVER registry if we're running in-process.
        try:
            from server import context as _ctx
            _ctx.register_critical_failure(
                f"llamacpp_offload_invariant({spec.name})",
                msg,
                severity="CRITICAL",
            )
        except Exception as _life_err:
            logger.error(f"supervisor: failed to register LIFESAVER for offload violation: {_life_err}")

    def _spawn(self, spec: InstanceSpec) -> bool:
        """Launch spec as a detached subprocess. Returns True if the process
        started. Health comes later via probe. Enforces full-offload invariant."""
        if not os.path.isfile(self._bin):
            logger.error(f"supervisor: binary not found at {self._bin}")
            return False
        if not os.path.isfile(spec.model_path):
            logger.error(f"supervisor: {spec.name} model missing: {spec.model_path}")
            return False
        if spec.lora_path and not os.path.isfile(spec.lora_path):
            logger.warning(f"supervisor: {spec.name} lora missing: {spec.lora_path} — launching without lora")
            spec.lora_path = None

        if spec.n_gpu_layers != 999:
            self._fire_offload_violation(
                spec,
                f"n_gpu_layers={spec.n_gpu_layers} (must be 999 for full offload)",
            )
            return False
        fits, reason = self._check_gpu_fits(spec)
        if not fits:
            self._fire_offload_violation(spec, reason)
            return False

        now = time.time()
        if spec.last_start > 0 and (now - spec.last_start) < self._min_restart_interval:
            logger.info(
                f"supervisor: {spec.name} restart cooldown "
                f"({int(now - spec.last_start)}s / {int(self._min_restart_interval)}s)"
            )
            return False

        argv = spec.build_argv(self._bin)
        os.makedirs(self._log_dir, exist_ok=True)
        log_path = os.path.join(self._log_dir, f"llama-server-{spec.name}.log")
        logger.info(f"supervisor: spawning {spec.name}: {' '.join(argv)}")
        try:
            stdout = open(log_path, "ab", buffering=0)
            stderr = stdout
            stdin = open("/dev/null", "rb")
            proc = subprocess.Popen(
                argv,
                stdin=stdin,
                stdout=stdout,
                stderr=stderr,
                start_new_session=True,
                close_fds=True,
            )
            spec.process = proc
            spec.last_start = now
            spec.restart_count += 1
            return True
        except Exception as e:
            logger.exception(f"supervisor: spawn {spec.name} failed: {e}")
            return False

    def ensure_all_running(self) -> dict[str, str]:
        """Spawn any instance that isn't already serving /health=ok. Adopts
        externally-launched survivors. Skipped while training lock is held."""
        if _training_locked():
            return {"status": "training_locked"}
        self.configure()
        result: dict[str, str] = {}
        with self._lock:
            for spec in self._instances.values():
                if self._probe_health(spec):
                    spec.last_health_ok = time.time()
                    result[spec.name] = "healthy"
                    continue
                if spec.process is not None and spec.process.poll() is None:
                    result[spec.name] = "starting"
                    continue
                ok = self._spawn(spec)
                result[spec.name] = "spawned" if ok else "spawn_failed"
        return result

    def health_tick(self) -> dict[str, dict]:
        """Probe all instances; restart any that are unhealthy (with cooldown)."""
        if _training_locked():
            return {"status": "training_locked"}
        out: dict[str, dict] = {}
        with self._lock:
            for spec in self._instances.values():
                healthy = self._probe_health(spec)
                if healthy:
                    spec.last_health_ok = time.time()
                    out[spec.name] = {
                        "healthy": True,
                        "url": spec.base_url(),
                        "restart_count": spec.restart_count,
                        "age_s": round(time.time() - spec.last_start, 1) if spec.last_start else None,
                    }
                    continue
                logger.warning(f"supervisor: {spec.name} unhealthy — attempting restart")
                spawn_ok = self._spawn(spec)
                out[spec.name] = {
                    "healthy": False,
                    "url": spec.base_url(),
                    "restart_attempted": True,
                    "spawn_ok": spawn_ok,
                    "restart_count": spec.restart_count,
                }
                if not spawn_ok:
                    try:
                        from server import context as _ctx
                        _ctx.register_critical_failure(
                            "llamacpp_supervisor",
                            f"{spec.name} ({spec.base_url()}) health failed and restart could not be attempted (cooldown or spawn error)",
                            severity="CRITICAL",
                        )
                    except Exception as _life_err:
                        logger.debug(f"supervisor: LIFESAVER register failed: {_life_err}")
        return out

    def stats(self) -> list[dict]:
        with self._lock:
            return [
                {
                    "name": s.name,
                    "url": s.base_url(),
                    "device": s.device,
                    "alias": s.alias,
                    "model": os.path.basename(s.model_path),
                    "lora": os.path.basename(s.lora_path) if s.lora_path else None,
                    "last_start": s.last_start,
                    "last_health_ok": s.last_health_ok,
                    "restart_count": s.restart_count,
                    "pid": (s.process.pid if s.process and s.process.poll() is None else None),
                }
                for s in self._instances.values()
            ]


# ══════════════════════════════════════════════════════════════════════════
#  Arbiter-busy flag + RAG routing
# ══════════════════════════════════════════════════════════════════════════
# Simple binary flag: set when an arbiter request starts, cleared when it
# finishes. RAG embed/rerank calls read this flag to choose GPU (arbiter
# idle) or CPU mirror (arbiter working) so embedding work never contends
# with an in-flight arbiter generation on the same GPU.

_arbiter_busy = threading.Event()


def arbiter_busy_set() -> None:
    _arbiter_busy.set()


def arbiter_busy_clear() -> None:
    _arbiter_busy.clear()


def rag_route() -> str:
    """Return 'cpu' if the arbiter is currently processing a request, else 'gpu'."""
    return "cpu" if _arbiter_busy.is_set() else "gpu"


# ══════════════════════════════════════════════════════════════════════════
#  Generation proxy (llamacpp-shape → llama-server OpenAI-shape)
# ══════════════════════════════════════════════════════════════════════════

def _resolve_base_url(model: str, instances: list[InstanceSpec]) -> str:
    """Map a model alias to the llama-server base URL that serves it."""
    for spec in instances:
        if spec.alias == model:
            return spec.base_url()
    # Unknown model → first arbiter-class instance
    for spec in instances:
        if spec.name == "arbiter":
            return spec.base_url()
    return instances[0].base_url() if instances else "http://127.0.0.1:8080"


def _generate_with_timeout(payload: dict, wall_timeout: float,
                           instances: list[InstanceSpec]) -> dict:
    """Translate an llamacpp /api/generate-shape request to llama-server
    OpenAI /v1/chat/completions and enforce a hard wall-clock cap."""
    model = payload.get("model", "")
    base = _resolve_base_url(model, instances)
    url = f"{base}/v1/chat/completions"

    prompt = payload.get("prompt", "")
    system = payload.get("system") or None
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    options = payload.get("options") or {}
    openai_payload = {
        "model": model,
        "messages": messages,
        "stream": False,
    }
    if "num_predict" in options:
        openai_payload["max_tokens"] = int(options["num_predict"])
    if "temperature" in options:
        openai_payload["temperature"] = float(options["temperature"])
    if "top_p" in options:
        openai_payload["top_p"] = float(options["top_p"])
    if "stop" in options:
        openai_payload["stop"] = options["stop"]

    body = json.dumps(openai_payload).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})

    result_box: list = [None, None]  # [response_dict, error_string]
    is_arbiter = any(spec.alias == model and spec.name == "arbiter" for spec in instances)
    if is_arbiter:
        arbiter_busy_set()

    def _worker():
        try:
            with urllib.request.urlopen(req, timeout=wall_timeout) as resp:
                result_box[0] = json.loads(resp.read())
        except Exception as e:
            result_box[1] = f"{type(e).__name__}: {e}"

    t = threading.Thread(target=_worker, daemon=True)
    try:
        t.start()
        t.join(timeout=wall_timeout)
        if t.is_alive():
            logger.warning(f"/generate: wall timeout ({wall_timeout}s) for {model} at {url}")
            return {"error": f"wall timeout after {wall_timeout}s", "timeout": True}
        if result_box[1]:
            return {"error": result_box[1], "timeout": "timed out" in result_box[1].lower()}
        # Translate OpenAI response back to llamacpp-shape for legacy callers.
        resp_body = result_box[0] or {}
        choices = resp_body.get("choices") or []
        text = ""
        if choices:
            msg = choices[0].get("message") or {}
            text = msg.get("content", "")
        usage = resp_body.get("usage") or {}
        return {
            "model": model,
            "response": text,
            "done": True,
            "done_reason": "stop",
            "prompt_eval_count": usage.get("prompt_tokens", 0),
            "eval_count": usage.get("completion_tokens", 0),
            "total_duration": 0,
        }
    finally:
        if is_arbiter:
            arbiter_busy_clear()


# ══════════════════════════════════════════════════════════════════════════
#  HTTP daemon
# ══════════════════════════════════════════════════════════════════════════

_supervisor_singleton = _Supervisor()
_supervisor_singleton.configure()


def _health_loop():
    while True:
        time.sleep(_HEALTH_INTERVAL)
        try:
            _supervisor_singleton.health_tick()
        except Exception as e:
            logger.error(f"supervisor health_tick failed: {e}")


class _ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send_json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            stats = _supervisor_singleton.stats()
            all_healthy = all(
                s.get("last_health_ok", 0) > time.time() - _HEALTH_INTERVAL * 2
                for s in stats
            ) if stats else False
            self._send_json(200, {
                "status": "ready" if all_healthy else "degraded",
                "training_locked": _training_locked(),
                "instances": stats,
                "arbiter_busy": _arbiter_busy.is_set(),
            })
        elif self.path == "/rag-route":
            self._send_json(200, {"route": rag_route(), "arbiter_busy": _arbiter_busy.is_set()})
        elif self.path == "/stats":
            self._send_json(200, {"instances": _supervisor_singleton.stats()})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except Exception:
            self._send_json(400, {"error": "bad request"})
            return

        if self.path == "/ensure-loaded":
            results = _supervisor_singleton.ensure_all_running()
            self._send_json(200, {"results": results})
        elif self.path == "/generate":
            if "model" not in body:
                self._send_json(400, {"error": "model required"})
                return
            wall_timeout = float(body.pop("wall_timeout", _DEFAULT_WALL_TIMEOUT))
            result = _generate_with_timeout(body, wall_timeout, _supervisor_singleton.instances())
            if "error" in result:
                self._send_json(504 if result.get("timeout") else 500, result)
            else:
                self._send_json(200, result)
        elif self.path == "/arbiter-busy":
            state = body.get("state", "")
            if state == "set":
                arbiter_busy_set()
                self._send_json(200, {"arbiter_busy": True})
            elif state == "clear":
                arbiter_busy_clear()
                self._send_json(200, {"arbiter_busy": False})
            else:
                self._send_json(400, {"error": "state must be 'set' or 'clear'"})
        else:
            self._send_json(404, {"error": "not found"})


def main():
    import argparse
    parser = argparse.ArgumentParser(description="HME llama.cpp persistence daemon")
    parser.add_argument("--port", type=int, default=7735)
    args = parser.parse_args()

    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    def _cleanup(signum, frame):
        try:
            os.unlink(PID_FILE)
        except OSError:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, _cleanup)
    signal.signal(signal.SIGINT, _cleanup)

    logger.info(f"llamacpp daemon starting on port {args.port} (pid={os.getpid()})")

    init_thread = threading.Thread(target=_supervisor_singleton.ensure_all_running, daemon=True)
    init_thread.start()

    health_thread = threading.Thread(target=_health_loop, daemon=True)
    health_thread.start()

    server = _ThreadingHTTPServer(("127.0.0.1", args.port), _Handler)
    logger.info(f"llamacpp daemon listening on 127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            os.unlink(PID_FILE)
        except OSError:
            pass


if __name__ == "__main__":
    main()
