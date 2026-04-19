"""llama-server supervisor — owns spawn, health, and autorestart for local inference.

Replaces the ad-hoc "arbiter was launched by something outside git, hope it
stays up" status quo with an in-process supervisor that:

1. Knows the exact launch command for each instance (arbiter + coder).
2. Spawns missing instances at shim startup.
3. Probes `/health` each tick; restarts dead instances.
4. Allocates GPUs deterministically: arbiter → GPU1 (small, 9 GB phi-4 Q4 +
   v6 LoRA), coder → GPU0 (big, 18.5 GB qwen3-coder 30b Q4) — matching the
   HME design in hme_http.py:126.
5. Fires a LIFESAVER when a restart fails.
6. Exposes stats() for selftest + status_unified.

The launch config lives in this file on purpose — it's HME's source of truth
for the inference topology, not a shell script floating outside the repo.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass, field

# Central .env loader — fail-fast semantics.
_mcp_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402

logger = logging.getLogger("HME")


@dataclass
class InstanceSpec:
    """Declarative launch plan for one llama-server instance."""
    name: str
    model_path: str
    port: int
    device: str           # Vulkan device string, e.g. "Vulkan1" / "Vulkan2"
    alias: str            # llama-server --alias (the model name clients use)
    ctx_size: int = 4096
    n_gpu_layers: int = 999   # offload everything
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


# Topology
# This is the authoritative inference allocation. Matches the comment in
# hme_http.py:126: "arbiter on GPU1 (small), coder on GPU0 (big)".
# Vulkan device indices: Vulkan0 = Intel iGPU, Vulkan1 = M40 #1, Vulkan2 = M40 #2.
# Environment overrides let the user retune without a code edit.
def _default_instances() -> list[InstanceSpec]:
    arbiter_model = ENV.require("HME_ARBITER")
    coder_model   = ENV.require("HME_CODER")
    # ARCHITECTURE INVARIANT: each model owns its GPU end-to-end. Full offload
    # only — partial offload to CPU is forbidden. n_gpu_layers is hardcoded to
    # 999 (offload everything). Spawn refuses with CRITICAL LIFESAVER if the
    # model + KV cache won't fit in the assigned device's free VRAM.
    return [
        InstanceSpec(
            name="arbiter",
            model_path=arbiter_model,
            port=ENV.require_int("HME_ARBITER_PORT"),
            device=ENV.require("HME_ARBITER_VULKAN"),
            alias=ENV.require("HME_ARBITER_MODEL"),
            ctx_size=ENV.require_int("HME_ARBITER_CTX"),
            n_gpu_layers=999,  # full offload — invariant
        ),
        InstanceSpec(
            name="coder",
            model_path=coder_model,
            port=ENV.require_int("HME_CODER_PORT"),
            device=ENV.require("HME_CODER_VULKAN"),
            alias=ENV.require("HME_CODER_ALIAS"),
            ctx_size=ENV.require_int("HME_CODER_CTX"),
            n_gpu_layers=999,  # full offload — invariant
        ),
    ]


# Supervisor
class _Supervisor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._instances: dict[str, InstanceSpec] = {}
        self._bin = ENV.require("HME_LLAMA_SERVER_BIN")
        self._log_dir = ENV.require("HME_LLAMA_LOG_DIR")
        self._health_timeout_s = ENV.require_float("HME_LLAMA_HEALTH_TIMEOUT")
        self._min_restart_interval = ENV.require_float("HME_LLAMA_RESTART_COOLDOWN")
        self._started = False

    def configure(self, instances: list[InstanceSpec] | None = None) -> None:
        """Idempotently register the target topology."""
        instances = instances or _default_instances()
        with self._lock:
            for spec in instances:
                existing = self._instances.get(spec.name)
                if existing is None:
                    self._instances[spec.name] = spec
                else:
                    # Update config fields while keeping runtime state
                    for k in ("model_path", "port", "device", "alias", "ctx_size",
                              "n_gpu_layers", "timeout_s", "lora_path"):
                        setattr(existing, k, getattr(spec, k))

    def instances(self) -> list[InstanceSpec]:
        with self._lock:
            return list(self._instances.values())

    # adoption: recognize externally-launched instances
    def _adopt_external(self, spec: InstanceSpec) -> bool:
        """If a llama-server is already listening on spec.port AND its /health
        reports ok, treat it as adopted — skip spawning our own. Returns True
        if adoption succeeded. Sets last_health_ok so the first tick sees it."""
        if self._probe_health(spec):
            logger.info(f"llamacpp_supervisor: {spec.name} already running at {spec.base_url()} — adopted")
            spec.last_health_ok = time.time()
            return True
        return False

    def _probe_health(self, spec: InstanceSpec) -> bool:
        """True iff /health responds with status=ok. 'loading' is not ok (not ready
        for traffic), but it IS a live process — callers must use _is_listening()
        to distinguish 'loading' from 'truly dead' before deciding to respawn."""
        try:
            req = urllib.request.Request(f"{spec.base_url()}/health")
            with urllib.request.urlopen(req, timeout=self._health_timeout_s) as resp:
                import json as _json
                body = resp.read().decode("utf-8", errors="replace")
                try:
                    data = _json.loads(body)
                except ValueError:
                    data = {}
                return resp.status == 200 and data.get("status") == "ok"
        except Exception as _probe_err:
            logger.debug(f"llamacpp_supervisor: /health probe failed for {spec.base_url()}: {type(_probe_err).__name__}: {_probe_err}")
            return False

    def _is_listening(self, spec: InstanceSpec) -> bool:
        """True iff something is bound to spec.port (even if /health is loading
        or erroring). Distinguishes 'live but warming up' from 'truly dead'.
        Any HTTP response — 200, 503 with status=loading, etc. — counts as
        listening. Only ConnectionRefused / timeout counts as dead."""
        try:
            req = urllib.request.Request(f"{spec.base_url()}/health")
            urllib.request.urlopen(req, timeout=self._health_timeout_s).read()
            return True
        except urllib.error.HTTPError:
            # Non-2xx response means the server IS listening — it just isn't ready.
            return True
        except Exception as _listen_err:
            logger.debug(f"supervisor: _is_listening probe for {spec.base_url()}: {type(_listen_err).__name__}: {_listen_err}")
            return False

    # GPU residence invariant
    def _vulkan_to_cuda_index(self, device: str) -> int | None:
        """Map a Vulkan device label to a CUDA-compatible index for nvidia-smi.

        HME topology: Vulkan0=Intel iGPU, Vulkan1=M40 #0 (CUDA 0), Vulkan2=M40 #1 (CUDA 1).
        Returns None for unknown devices (caller should treat as CPU = invariant violation).
        """
        if device == "Vulkan1":
            return 0
        if device == "Vulkan2":
            return 1
        return None

    def _gpu_free_mb(self, cuda_idx: int) -> int | None:
        """Return free VRAM on the given CUDA index in MiB, or None if probe fails."""
        try:
            out = subprocess.check_output(
                ["nvidia-smi", f"--query-gpu=memory.free", "--format=csv,noheader,nounits", f"--id={cuda_idx}"],
                stderr=subprocess.DEVNULL,
                timeout=3,
            )
            return int(out.decode().strip().splitlines()[0])
        except Exception as _gpu_err:
            logger.warning(f"llamacpp_supervisor: nvidia-smi probe failed for cuda:{cuda_idx}: {_gpu_err}")
            return None

    def _check_gpu_fits(self, spec: InstanceSpec) -> tuple[bool, str]:
        """Return (True, '') if model+KV cache fits in assigned GPU free VRAM
        with the configured headroom, else (False, reason).

        Conservative estimate: model file size (GGUF on-disk ≈ on-GPU) plus a
        KV-cache budget of ctx_size * 0.5 MB (rough for 30B-class). Headroom of
        1024 MB on top.
        """
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

        # KV cache budget: bytes ≈ 2 (K+V) * n_layers * hidden * ctx_size * dtype_bytes.
        # Without parsing the GGUF, use a conservative per-token estimate that
        # covers both arbiter (phi-4 14B, ~70 KB/token) and coder (qwen3-coder
        # 30B MoE, ~80 KB/token). 0.5 MB/token = 512 KB/token, generous.
        kv_mb = (spec.ctx_size * 512) // 1024
        headroom_mb = 1024
        needed_mb = model_mb + kv_mb + headroom_mb

        # If the existing process for this spec is already on the GPU, its
        # model_mb is already counted as "used" — we must credit it back before
        # deciding whether we'd fit. Without this, a respawn during model load
        # incorrectly fires the offload-invariant CRITICAL (the check sees
        # free=5GB because coder is already using 19GB of 24GB, then says
        # coder doesn't fit — but coder already fit; it's the same coder).
        if self._is_listening(spec):
            free_mb += model_mb  # model is already there, so that VRAM is "ours"

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
            f"Each HME model OWNS its GPU. Free the assigned device and restart the shim."
        )
        logger.error(f"llamacpp_supervisor: {msg}")
        try:
            from server import context as _ctx
            _ctx.register_critical_failure(
                f"llamacpp_offload_invariant({spec.name})",
                msg,
                severity="CRITICAL",
            )
        except Exception as _life_err:
            logger.error(f"llamacpp_supervisor: failed to register LIFESAVER for offload violation: {_life_err}")

    # spawn
    def _spawn(self, spec: InstanceSpec) -> bool:
        """Launch spec as a detached subprocess. Returns True if the process
        started (not that it's healthy yet — that's for the next health tick).

        ARCHITECTURE INVARIANT: refuses to spawn if model would offload to CPU.
        Full GPU residence is guaranteed by HME's design. A model that doesn't
        fit on its assigned device is a CRITICAL LIFESAVER, not a degradation.
        """
        if not os.path.isfile(self._bin):
            logger.error(f"llamacpp_supervisor: binary not found at {self._bin}")
            return False
        if not os.path.isfile(spec.model_path):
            logger.error(f"llamacpp_supervisor: {spec.name} model missing: {spec.model_path}")
            return False
        if spec.lora_path and not os.path.isfile(spec.lora_path):
            logger.warning(f"llamacpp_supervisor: {spec.name} lora missing: {spec.lora_path} — launching without lora")
            spec.lora_path = None

        # Invariant check: full offload must fit in assigned GPU's free VRAM.
        # n_gpu_layers must be 999 (full) per HME architecture.
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

        # Rate-limit restarts to avoid spinning on a broken config
        now = time.time()
        if spec.last_start > 0 and (now - spec.last_start) < self._min_restart_interval:
            logger.info(
                f"llamacpp_supervisor: {spec.name} restart cooldown "
                f"({int(now - spec.last_start)}s / {int(self._min_restart_interval)}s)"
            )
            return False

        argv = spec.build_argv(self._bin)
        os.makedirs(self._log_dir, exist_ok=True)
        log_path = os.path.join(self._log_dir, f"llama-server-{spec.name}.log")
        logger.info(f"llamacpp_supervisor: spawning {spec.name}: {' '.join(argv)}")
        try:
            # Detached: own session, own stdout/stderr → log file, stdin /dev/null.
            # Doesn't die when the shim dies. Doesn't inherit the shim's fds.
            stdout = open(log_path, "ab", buffering=0)
            stderr = stdout
            stdin = open("/dev/null", "rb")
            proc = subprocess.Popen(
                argv,
                stdin=stdin,
                stdout=stdout,
                stderr=stderr,
                start_new_session=True,  # detached — survives shim exit
                close_fds=True,
            )
            spec.process = proc
            spec.last_start = now
            spec.restart_count += 1
            return True
        except Exception as e:
            logger.exception(f"llamacpp_supervisor: spawn {spec.name} failed: {e}")
            return False

    # public: ensure all
    def ensure_all_running(self) -> dict[str, str]:
        """Spawn any instance that isn't already serving /health=ok. Adopts
        externally-launched survivors. Returns {name: status} for logging."""
        self.configure()
        result: dict[str, str] = {}
        with self._lock:
            for spec in self._instances.values():
                if self._probe_health(spec):
                    spec.last_health_ok = time.time()
                    result[spec.name] = "healthy"
                    continue
                # Dead — check if we already spawned a process that's mid-load
                if spec.process is not None and spec.process.poll() is None:
                    result[spec.name] = "starting"
                    continue
                # Port is bound but /health not ok → model is loading. Do not
                # respawn; the existing process (ours or externally-launched)
                # is already taking its GPU. Trying to spawn a duplicate is
                # what fires the "offload invariant violated" false alarm.
                if self._is_listening(spec):
                    result[spec.name] = "loading"
                    continue
                # Spawn fresh
                ok = self._spawn(spec)
                result[spec.name] = "spawned" if ok else "spawn_failed"
        return result

    # health tick
    def health_tick(self) -> dict[str, dict]:
        """Probe all instances. Restart any that are unhealthy (with cooldown).
        Returns detailed per-instance status — suitable for logging / selftest."""
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
                # Unhealthy but still listening → loading, not dead. Skip respawn.
                if self._is_listening(spec):
                    out[spec.name] = {
                        "healthy": False,
                        "loading": True,
                        "url": spec.base_url(),
                        "restart_count": spec.restart_count,
                    }
                    continue
                # Unhealthy — restart if not in cooldown
                logger.warning(
                    f"llamacpp_supervisor: {spec.name} unhealthy — attempting restart"
                )
                spawn_ok = self._spawn(spec)
                out[spec.name] = {
                    "healthy": False,
                    "url": spec.base_url(),
                    "restart_attempted": True,
                    "spawn_ok": spawn_ok,
                    "restart_count": spec.restart_count,
                }
                if not spawn_ok:
                    # Fire a LIFESAVER when restart fails
                    try:
                        from server import context as _ctx
                        _ctx.register_critical_failure(
                            "llamacpp_supervisor",
                            f"{spec.name} ({spec.base_url()}) health failed and restart could not be attempted (cooldown or spawn error)",
                            severity="CRITICAL",
                        )
                    except Exception as _life_err:
                        logger.debug(f"llamacpp_supervisor: LIFESAVER register failed: {_life_err}")
        return out

    # stats for selftest
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


_supervisor: _Supervisor | None = None
_singleton_lock = threading.Lock()


def get_supervisor() -> _Supervisor:
    global _supervisor
    with _singleton_lock:
        if _supervisor is None:
            _supervisor = _Supervisor()
            _supervisor.configure()
        return _supervisor


def ensure_all_running() -> dict[str, str]:
    """Top-level helper — call from shim startup and from health monitor tick."""
    return get_supervisor().ensure_all_running()


def health_tick() -> dict[str, dict]:
    return get_supervisor().health_tick()


def stats() -> list[dict]:
    return get_supervisor().stats()
