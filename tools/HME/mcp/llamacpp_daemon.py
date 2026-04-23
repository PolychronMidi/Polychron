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

# Single source of truth: tools/HME/config/versions.json.
# The daemon, worker, proxy, and cli all read from here. Runtime drift
# between components (e.g. daemon from before a protocol bump talking to
# a post-bump worker) is caught by selftest's version-consistency probe
# and surfaced in the health summary.
def _load_daemon_version() -> str:
    _p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config", "versions.json")
    try:
        with open(_p) as _f:
            return json.load(_f).get("daemon", "unknown")
    except Exception as _ver_err:
        print(f"daemon: versions.json read failed: {type(_ver_err).__name__}: {_ver_err}", file=sys.stderr)
        return "unknown"


DAEMON_VERSION = _load_daemon_version()

_DEFAULT_WALL_TIMEOUT = 45  # hard wall-clock cap for /generate proxy
_HEALTH_INTERVAL = 60       # self-health-tick interval (s)


def _training_locked() -> bool:
    """Skip all auto-spawn/restart when the training lock is held."""
    return os.path.exists(TRAINING_LOCK)



#  InstanceSpec + Supervisor


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
    suspended: bool = False  # when True, supervisor won't auto-restart this instance

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
            timeout_s=ENV.optional_int("HME_ARBITER_TIMEOUT", 120),
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

    def _is_listening(self, spec: InstanceSpec) -> bool:
        """Distinguish 'loading' (port bound but /health not ok) from 'truly dead'.
        Any HTTP response — 200, 503 with status=loading, etc. — counts as
        listening. Only ConnectionRefused / timeout counts as dead."""
        try:
            urllib.request.urlopen(f"{spec.base_url()}/health", timeout=self._health_timeout_s).read()
            return True
        except urllib.error.HTTPError:
            return True
        except Exception as _listen_err:
            logger.debug(f"supervisor: _is_listening probe failed for {spec.base_url()}: {type(_listen_err).__name__}: {_listen_err}")
            return False

    # GPU residence invariant
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

    def assert_topology_ready(self) -> None:
        """Fail-fast pre-boot assertion: refuse to start if the GPU/port
        environment isn't what the topology declares. Raises RuntimeError
        with a concrete remediation message on any violation.

        The original failure mode this guards against: a prior daemon died
        uncleanly, leaving its llama-server children running. A fresh
        daemon then ran its health loop against the orphans, mis-attributed
        their VRAM usage, and the next indexing-mode crashed on OOM when
        the "free" GPU wasn't actually free. Catching it at boot turns a
        mysterious mid-operation OOM into a readable startup error.
        """
        self.configure()
        # Check nvidia-smi is callable at all.
        try:
            subprocess.check_output(
                ["nvidia-smi", "--query-gpu=count", "--format=csv,noheader"],
                stderr=subprocess.PIPE, timeout=3,
            )
        except FileNotFoundError as e:
            raise RuntimeError(
                f"daemon: nvidia-smi binary not found ({e}) — cannot probe GPUs. "
                f"Install the NVIDIA driver or adjust PATH."
            )
        except subprocess.CalledProcessError as e:
            raise RuntimeError(
                f"daemon: nvidia-smi call failed (rc={e.returncode}): "
                f"{e.stderr.decode(errors='replace')[:300]}"
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(
                "daemon: nvidia-smi timed out after 3s — driver hung?"
            )

        # For every declared instance: GPU index must resolve, VRAM must be
        # large enough to fit the model, and the port must either be free or
        # held by a process we adopt (llama-server that matches spec).
        for spec in self._instances.values():
            cuda_idx = self._vulkan_to_cuda_index(spec.device)
            if cuda_idx is None:
                raise RuntimeError(
                    f"daemon: {spec.name}.device={spec.device!r} does not map to a CUDA "
                    f"index. Supported: Vulkan1=cuda:0, Vulkan2=cuda:1."
                )
            free = self._gpu_free_mb(cuda_idx)
            if free is None:
                raise RuntimeError(
                    f"daemon: GPU{cuda_idx} ({spec.device}) unreachable via nvidia-smi. "
                    f"Check driver / card connectivity."
                )
            # Before-spawn fit check uses the same accounting as _check_gpu_fits.
            fits, reason = self._check_gpu_fits(spec)
            if not fits:
                # If the port is already bound, the existing process owns the
                # VRAM we're measuring — adoption is legitimate. Let the
                # health loop adopt it. Otherwise this is a real conflict.
                if not self._is_listening(spec):
                    rogue = self._find_pid_on_port(spec.port)
                    raise RuntimeError(
                        f"daemon: {spec.name} cannot fit on {spec.device} ({reason}). "
                        f"Port {spec.port} {'held by PID ' + str(rogue) if rogue else 'is free'}. "
                        f"Free the GPU (kill orphan llama-server / stop other CUDA "
                        f"process) then restart the daemon."
                    )
            logger.info(
                f"daemon: topology OK — {spec.name} on {spec.device} "
                f"(free={free} MB, port={spec.port}"
                f"{', adopted' if self._is_listening(spec) else ''})"
            )

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
        # Headroom covers compute buffers + worker python's ~150 MB residual
        # CUDA context that survives indexing-mode reload cycles. 1024 MB
        # was excessive — it left coder unable to spawn after every reindex
        # because the residual context made `free_mb` 50-200 MB short of
        # the inflated requirement. 256 MB is enough for compute buffers.
        headroom_mb = 256
        needed_mb = model_mb + kv_mb + headroom_mb

        # Credit back the existing process's model_mb when the port is bound —
        # the existing loading process is occupying that VRAM, not stealing it.
        # Without this, self-respawn during model load fires a false offload
        # invariant CRITICAL.
        if self._is_listening(spec):
            free_mb += model_mb

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

    def _spawn(self, spec: InstanceSpec, *, bypass_cooldown: bool = False) -> bool:
        """Launch spec as a detached subprocess. Returns True if the process
        started. Health comes later via probe. Enforces full-offload invariant.

        bypass_cooldown=True skips the crash-loop cooldown gate. Use ONLY
        for planned restarts (e.g. indexing-mode resume) where we just
        intentionally killed the process — the cooldown exists to prevent
        crash-respawn-crash storms, not to throttle legitimate lifecycle
        operations.
        """
        # Single-writer invariant: only llamacpp_daemon may spawn llama-server.
        # This assertion catches the class of bug we fixed tonight where a
        # second supervisor (in worker.py) tried to spawn the same processes.
        # Use __file__ (not __name__): daemon runs as a script, so __name__
        # is "__main__" but __file__ reliably contains "llamacpp_daemon.py".
        try:
            from server.lifecycle_writers import assert_writer
            assert_writer("llama-server", __file__)
        except ImportError:  # silent-ok: lifecycle_writers optional when running daemon standalone
            pass
        # Defense-in-depth: never spawn a suspended instance even if a caller
        # bypasses the ensure_all_running / health_tick gates. indexing-mode
        # flips suspended=True before freeing the GPU; a spawn here would
        # land directly into the embedder's working VRAM and OOM.
        if spec.suspended:
            logger.error(
                f"supervisor: refusing to spawn suspended instance {spec.name} — "
                f"only resume() may clear the suspended flag"
            )
            return False
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
        if (
            not bypass_cooldown
            and spec.last_start > 0
            and (now - spec.last_start) < self._min_restart_interval
        ):
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

    def _find_pid_on_port(self, port: int) -> int | None:
        """Find PID listening on `port` via lsof. Used to kill adopted instances
        that the daemon didn't spawn (spec.process is None)."""
        try:
            out = subprocess.check_output(
                ["lsof", "-ti", f"TCP:{port}", "-sTCP:LISTEN"],
                stderr=subprocess.DEVNULL, timeout=3,
            )
            for line in out.decode().strip().splitlines():
                pid = int(line.strip())
                if pid != os.getpid():
                    return pid
        except Exception as _lsof_err:
            logger.debug(f"supervisor: lsof probe failed for port {port}: {_lsof_err}")
        return None

    def suspend(self, name: str) -> dict:
        """Suspend an instance: kill its process + prevent auto-restart.
        Used by indexing mode to free a GPU for embedding work.

        Fail-fast contract: returns {"error": ...} unless EVERY process
        listening on spec.port has been terminated. The original failure
        mode this guards against was a duplicate llama-server (spawned by
        a competing supervisor) staying alive on the GPU after suspend
        returned success — the embedder then OOM'd because the GPU it
        thought was free was still half-occupied. We now re-scan the port
        in a kill loop until no process holds it.
        """
        with self._lock:
            spec = self._instances.get(name)
            if not spec:
                return {"error": f"unknown instance: {name}"}
            spec.suspended = True
            killed_pids: list[int] = []

            if spec.process is not None and spec.process.poll() is None:
                spec.process.terminate()
                try:
                    spec.process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    spec.process.kill()
                    try:
                        spec.process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        return {"error": f"{name}: SIGKILL did not reap PID {spec.process.pid}"}
                killed_pids.append(spec.process.pid)
                spec.process = None

            # Walk the port until no PID is listening. Each iteration finds
            # one PID, sends SIGTERM, polls 10s for exit, escalates to
            # SIGKILL. If after 5 sweeps the port is still bound, we hard
            # fail rather than mislead the indexing-mode caller.
            for _sweep in range(5):
                pid = self._find_pid_on_port(spec.port)
                if pid is None:
                    break
                if pid == os.getpid():
                    return {"error": f"{name}: spec.port {spec.port} is held by the daemon itself — config bug"}
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    killed_pids.append(pid)
                    continue
                except PermissionError as e:
                    return {"error": f"{name}: cannot signal PID {pid} on port {spec.port}: {e}"}
                except OSError as e:
                    return {"error": f"{name}: SIGTERM PID {pid} failed: {e}"}
                for _ in range(20):
                    time.sleep(0.5)
                    try:
                        os.kill(pid, 0)
                    except ProcessLookupError:
                        break
                else:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    except OSError as e:
                        return {"error": f"{name}: SIGKILL PID {pid} failed: {e}"}
                killed_pids.append(pid)
            else:
                # Loop exhausted without breaking — port still bound.
                pid = self._find_pid_on_port(spec.port)
                return {"error": f"{name}: port {spec.port} still bound by PID {pid} after 5 kill sweeps"}

            if killed_pids:
                logger.info(f"supervisor: {name} suspended (PIDs terminated: {killed_pids})")
            else:
                logger.info(f"supervisor: {name} suspended (no process found)")
            return {"name": name, "suspended": True, "killed_pids": killed_pids}

    def resume(self, name: str) -> dict:
        """Resume a suspended instance: clear flag + spawn immediately.

        bypass_cooldown=True on the spawn: suspend+resume is always a
        planned operation (indexing-mode orchestration), not a crash.
        Honoring the crash-loop cooldown here leaves the instance down
        for HME_LLAMA_RESTART_COOLDOWN seconds after every reindex, which
        is a correctness bug masquerading as a safety check.
        """
        with self._lock:
            spec = self._instances.get(name)
            if not spec:
                return {"error": f"unknown instance: {name}"}
            spec.suspended = False
            ok = self._spawn(spec, bypass_cooldown=True)
            logger.info(f"supervisor: {name} resumed (spawned={ok})")
            return {"name": name, "suspended": False, "spawned": ok}

    def ensure_all_running(self) -> dict[str, str]:
        """Spawn any instance that isn't already serving /health=ok. Adopts
        externally-launched survivors. Skipped while training lock or suspended."""
        if _training_locked():
            return {"status": "training_locked"}
        self.configure()
        result: dict[str, str] = {}
        with self._lock:
            for spec in self._instances.values():
                if spec.suspended:
                    result[spec.name] = "suspended"
                    continue
                if self._probe_health(spec):
                    spec.last_health_ok = time.time()
                    result[spec.name] = "healthy"
                    continue
                if spec.process is not None and spec.process.poll() is None:
                    result[spec.name] = "starting"
                    continue
                # Port bound but /health not ok → model is loading; do not respawn.
                if self._is_listening(spec):
                    result[spec.name] = "loading"
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
                if spec.suspended:
                    out[spec.name] = {"healthy": False, "suspended": True}
                    continue
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
                # Port bound but not healthy → still loading; skip respawn.
                if self._is_listening(spec):
                    out[spec.name] = {
                        "healthy": False,
                        "loading": True,
                        "url": spec.base_url(),
                        "restart_count": spec.restart_count,
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



#  Per-GPU busy flags + RAG routing

# Each physical GPU (keyed by Vulkan tag) has its own busy flag. A generation
# call flips the flag for the GPU its target instance lives on; callers on
# that GPU (RAG stack on GPU0, audio models on GPU1, etc.) read the flag to
# route GPU (idle) or CPU mirror (busy). Flag is device-based, not name-
# based — so future instances scheduled onto either GPU participate without
# code changes.
#
# Watchdog: if any flag stays set for > WATCHDOG_S the daemon force-clears
# with a warning so a bug in set/clear pairing can't permanently strand
# callers on CPU.
#
# Backcompat: the pre-existing single-flag API (_rag_gpu_busy,
# arbiter_busy_set/clear, rag_route()) still works — it targets the "default"
# device (arbiter's), so old callers behave exactly as before.

_gpu_busy_flags: dict[str, dict] = {}  # vulkan_tag → {event, set_ts}
_gpu_busy_lock = threading.Lock()
_GPU_BUSY_WATCHDOG_S = 300.0  # 5 min max — longest legit arbiter/coder generation
_default_device_cache: str | None = None  # first arbiter device we saw


def _ensure_device_slot_locked(device: str) -> dict:
    """Must hold _gpu_busy_lock. Lazily create the per-device state."""
    if device not in _gpu_busy_flags:
        _gpu_busy_flags[device] = {
            "event": threading.Event(),
            "set_ts": 0.0,
        }
    return _gpu_busy_flags[device]


def gpu_busy_set(device: str) -> None:
    """Mark `device` busy. Device is a Vulkan tag like 'Vulkan1'."""
    with _gpu_busy_lock:
        slot = _ensure_device_slot_locked(device)
        slot["event"].set()
        slot["set_ts"] = time.time()


def gpu_busy_clear(device: str) -> None:
    with _gpu_busy_lock:
        slot = _ensure_device_slot_locked(device)
        slot["event"].clear()


def gpu_busy_current(device: str) -> bool:
    """Read device flag with watchdog — auto-clear if held past WATCHDOG_S."""
    with _gpu_busy_lock:
        slot = _gpu_busy_flags.get(device)
        if slot is None:
            return False
        if slot["event"].is_set():
            age = time.time() - slot["set_ts"]
            if age > _GPU_BUSY_WATCHDOG_S:
                logger.warning(
                    f"gpu_busy watchdog ({device}): flag held {age:.0f}s > "
                    f"{_GPU_BUSY_WATCHDOG_S:.0f}s — force-clearing. Check for "
                    f"a stuck generation or missing clear."
                )
                slot["event"].clear()
                return False
            return True
        return False


def gpu_busy_snapshot() -> dict[str, bool]:
    """All known device flags as a dict, with watchdog applied. Used for
    multi-device health / status endpoints."""
    with _gpu_busy_lock:
        devices = list(_gpu_busy_flags.keys())
    return {d: gpu_busy_current(d) for d in devices}


def _get_default_device() -> str:
    """Return the device used when callers don't specify one. Reads from the
    central .env via ENV.require — no silent fallbacks, no supervisor-probe
    inference. If HME_RAG_VULKAN is missing the process fails loud."""
    global _default_device_cache
    if _default_device_cache is not None:
        return _default_device_cache
    _default_device_cache = ENV.require("HME_RAG_VULKAN")
    return _default_device_cache


# Backcompat shims (single-flag API targets the default/arbiter device)
def rag_gpu_busy_set() -> None:
    gpu_busy_set(_get_default_device())


def rag_gpu_busy_clear() -> None:
    gpu_busy_clear(_get_default_device())


def _rag_gpu_busy_current() -> bool:
    return gpu_busy_current(_get_default_device())


class _LegacyRagFlag:
    """Lightweight stand-in for the old `_rag_gpu_busy = threading.Event()`
    reference. Exposes `.is_set()` so stale code paths keep compiling."""
    def is_set(self) -> bool:
        return _rag_gpu_busy_current()


_rag_gpu_busy = _LegacyRagFlag()
_arbiter_busy = _rag_gpu_busy


def arbiter_busy_set() -> None:
    rag_gpu_busy_set()


def arbiter_busy_clear() -> None:
    rag_gpu_busy_clear()


def rag_route(device: str | None = None) -> str:
    """Return 'cpu' if `device` (or the default device) is currently under
    generation load, else 'gpu'."""
    if device is None:
        device = _get_default_device()
    return "cpu" if gpu_busy_current(device) else "gpu"


def _resolve_rag_gpu_device(instances: list) -> str | None:
    """The Vulkan tag of the physical GPU that RAG lives on. Reads
    HME_RAG_VULKAN from .env via ENV.require — no silent default."""
    return ENV.require("HME_RAG_VULKAN")



#  Generation proxy (llamacpp-shape → llama-server OpenAI-shape)


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
    OpenAI /v1/chat/completions and enforce a hard wall-clock cap.

    Accepts two payload shapes:
      - Single-turn: prompt + optional system → constructed messages array
      - Multi-turn:  messages array (pre-built OpenAI format) used directly
    Top-level max_tokens/temperature override options.* equivalents.
    """
    model = payload.get("model", "")
    base = _resolve_base_url(model, instances)
    url = f"{base}/v1/chat/completions"

    if "messages" in payload:
        # Multi-turn path: _local_chat passes a pre-built messages array.
        messages = payload["messages"]
    else:
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
    # Top-level max_tokens/temperature take precedence over options.*
    if "max_tokens" in payload:
        openai_payload["max_tokens"] = int(payload["max_tokens"])
    elif "num_predict" in options:
        openai_payload["max_tokens"] = int(options["num_predict"])
    if "temperature" in payload:
        openai_payload["temperature"] = float(payload["temperature"])
    elif "temperature" in options:
        openai_payload["temperature"] = float(options["temperature"])
    if "top_p" in options:
        openai_payload["top_p"] = float(options["top_p"])
    if "stop" in options:
        openai_payload["stop"] = options["stop"]
    if "response_format" in payload:
        openai_payload["response_format"] = payload["response_format"]

    body = json.dumps(openai_payload).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})

    result_box: list = [None, None]  # [response_dict, error_string]
    # Flip the busy flag for the GPU that this generation's target instance
    # lives on. Per-GPU: callers on that device (RAG on GPU0, audio on GPU1,
    # future models on either) route to CPU for the duration of the call.
    target_spec = next((spec for spec in instances if spec.alias == model), None)
    busy_device = target_spec.device if target_spec is not None else None
    if busy_device is not None:
        gpu_busy_set(busy_device)

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
        if busy_device is not None:
            gpu_busy_clear(busy_device)



#  HTTP daemon


_supervisor_singleton = _Supervisor()
_supervisor_singleton.configure()


_indexing_mode_lock = threading.Lock()


def _run_indexing_mode() -> dict:
    """Orchestrate GPU-dedicated full reindex. Called by /indexing-mode handler.

    Steps:
      1. Suspend coder → free GPU1 (Vulkan2/cuda:1)
      2. Tell shim to reload embedding models on cuda:1
      3. Tell shim to run index_directory
      4. Tell shim to restore models to original device
      5. Resume coder
    ALL GPU allocation goes through this daemon. The shim never decides
    which GPU to use — the daemon tells it.
    """
    if not _indexing_mode_lock.acquire(blocking=False):
        return {"error": "indexing mode already in progress"}

    try:
        return _run_indexing_mode_locked()
    finally:
        _indexing_mode_lock.release()


def _run_indexing_mode_locked() -> dict:
    _SHIM_PORT = ENV.optional_int("HME_SHIM_PORT", 9098)
    _SHIM_URL = f"http://127.0.0.1:{_SHIM_PORT}"

    def _shim_post(endpoint: str, data: dict, timeout: float = 30) -> dict:
        req = urllib.request.Request(
            f"{_SHIM_URL}{endpoint}",
            data=json.dumps(data).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            resp = urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            try:
                return json.loads(body)
            except ValueError:
                raise RuntimeError(f"shim {endpoint} returned HTTP {e.code}: {body[:200]}") from e
        result = json.loads(resp.read())
        if isinstance(result, dict) and result.get("error"):
            logger.warning(f"shim {endpoint} returned error: {result['error']}")
        return result

    # Determine indexing GPU from coder's device (Vulkan2 → cuda:1)
    coder_spec = None
    for spec in _supervisor_singleton.instances():
        if spec.name == "coder":
            coder_spec = spec
            break
    if coder_spec is None:
        return {"error": "no coder instance configured"}

    cuda_idx = _supervisor_singleton._vulkan_to_cuda_index(coder_spec.device)
    if cuda_idx is None:
        return {"error": f"cannot map {coder_spec.device} to CUDA index"}
    indexing_device = f"cuda:{cuda_idx}"

    logger.info(f"indexing-mode: starting — will use {indexing_device} (freed by suspending coder)")

    # Step 1: Suspend coder to free GPU1
    suspended = False
    try:
        result = _supervisor_singleton.suspend("coder")
        if result.get("error"):
            return {"error": f"suspend coder failed: {result['error']}"}
        suspended = True
        logger.info("indexing-mode: coder suspended")
    except Exception as e:
        return {"error": f"suspend coder failed: {e}"}

    # Wait for GPU memory to actually free up after coder termination.
    # CUDA doesn't release VRAM instantly — poll nvidia-smi until the GPU
    # has significant free space (coder uses ~18 GB of 22 GB).
    _min_free_mb = 15000  # expect ~18 GB free after coder dies on a 22 GB card
    for _poll in range(30):
        time.sleep(2)
        free = _supervisor_singleton._gpu_free_mb(cuda_idx)
        if free is not None and free >= _min_free_mb:
            logger.info(f"indexing-mode: GPU{cuda_idx} has {free} MB free — proceeding")
            break
        logger.debug(f"indexing-mode: waiting for GPU{cuda_idx} to free up (poll {_poll}, free={free})")
    else:
        free = _supervisor_singleton._gpu_free_mb(cuda_idx)
        logger.warning(f"indexing-mode: GPU{cuda_idx} only has {free} MB free after 60s — proceeding anyway")

    try:
        # Step 2: Tell shim to reload embeddings on the freed GPU.
        # Cold-start reload: 3 SentenceTransformer instances + FP16 GPU
        # allocation + up to 30s of _engine_ready wait if boot overlap.
        # 300s covers the observed ~90-120s worst case with margin.
        try:
            reload_result = _shim_post("/reload-engines", {"device": indexing_device}, timeout=300)
            if reload_result.get("error"):
                logger.warning(f"indexing-mode: reload-engines failed: {reload_result['error']}")
                return {"error": f"reload-engines failed: {reload_result['error']}"}
            logger.info(f"indexing-mode: models reloaded on {indexing_device}: {reload_result.get('reloaded', [])}")
        except Exception as e:
            logger.error(f"indexing-mode: reload-engines request failed: {e}")
            return {"error": f"reload-engines request failed: {e}"}

        # Defense check: confirm no rogue llama-server snuck back onto the
        # indexing GPU during the ~10-90s reload window. The original failure
        # mode was a competing supervisor respawning coder concurrently with
        # the embedder reload, so the embedder's index pass OOM'd against the
        # squatter. Now that the worker-side supervisor is removed, the only
        # spawner is the daemon's own loops — which honor spec.suspended —
        # but defense-in-depth: refuse to proceed if any non-embedder process
        # holds VRAM on this GPU.
        rogue = _supervisor_singleton._find_pid_on_port(coder_spec.port)
        if rogue is not None:
            return {
                "error": (
                    f"rogue process PID {rogue} listening on coder port {coder_spec.port} "
                    f"during indexing-mode — abort to prevent OOM. The daemon's suspended "
                    f"flag should have prevented respawn; investigate spawn paths."
                )
            }
        free_after_reload = _supervisor_singleton._gpu_free_mb(cuda_idx)
        if free_after_reload is not None and free_after_reload < 2000:
            return {
                "error": (
                    f"GPU{cuda_idx} only {free_after_reload} MB free after embedder reload — "
                    f"unexpected memory pressure. Aborting before index_directory OOMs."
                )
            }

        # Step 3: Tell shim to run index_directory
        try:
            index_result = _shim_post(
                "/rag",
                {"engine": "project", "method": "index_directory"},
                timeout=500,
            )
            result_data = index_result.get("result", index_result)
            logger.info(f"indexing-mode: index complete: {result_data}")
        except Exception as e:
            logger.error(f"indexing-mode: index_directory failed: {e}")
            result_data = {"error": f"index_directory failed: {e}"}

    finally:
        # Step 4: Tell shim to restore models to original device
        try:
            restore_result = _shim_post("/reload-engines", {"device": "restore"}, timeout=300)
            if restore_result.get("error"):
                logger.error(f"indexing-mode: restore returned error: {restore_result['error']}")
            else:
                logger.info(f"indexing-mode: models restored: {restore_result}")
        except Exception as e:
            logger.error(f"indexing-mode: restore failed: {e} — models may still be on {indexing_device}")

        # Step 5: Resume coder (only if we suspended it). If the first spawn
        # attempt fails due to VRAM fits (stale CUDA context from the
        # embedder we just moved back), nvidia-smi may take a few seconds
        # to reflect the freed memory after empty_cache. Retry up to 3
        # times with a 3s gap between attempts. If we still can't spawn,
        # fire a CRITICAL LIFESAVER with the exact shortfall instead of
        # letting the health-tick silently retry every 60s for minutes.
        if suspended:
            try:
                resume_result = _supervisor_singleton.resume("coder")
                for _retry in range(3):
                    if resume_result.get("error") or resume_result.get("spawned"):
                        break
                    time.sleep(3)
                    free_mb = _supervisor_singleton._gpu_free_mb(cuda_idx)
                    logger.info(
                        f"indexing-mode: coder spawn retry {_retry + 1}/3 — "
                        f"GPU{cuda_idx} has {free_mb} MB free"
                    )
                    with _supervisor_singleton._lock:
                        resume_result = {
                            "name": "coder",
                            "suspended": False,
                            "spawned": _supervisor_singleton._spawn(
                                _supervisor_singleton._instances["coder"],
                                bypass_cooldown=True,
                            ),
                        }
                if resume_result.get("error"):
                    logger.error(f"indexing-mode: resume returned error: {resume_result['error']}")
                elif not resume_result.get("spawned"):
                    free_mb = _supervisor_singleton._gpu_free_mb(cuda_idx)
                    msg = (
                        f"coder respawn failed after 3 retries post-indexing-mode — "
                        f"GPU{cuda_idx} has {free_mb} MB free, coder needs "
                        f"~{_supervisor_singleton._instances['coder'].ctx_size // 2 + 17697 + 256} MB "
                        f"(model+kv+headroom). Likely residual CUDA context from the embedder. "
                        f"Manual remediation: restart the worker (kill pid of worker.py)."
                    )
                    logger.error(f"indexing-mode: {msg}")
                    try:
                        from server import context as _ctx
                        _ctx.register_critical_failure(
                            "llamacpp_indexing_mode_resume",
                            msg,
                            severity="CRITICAL",
                        )
                    except Exception as _life_err:
                        logger.debug(f"indexing-mode: LIFESAVER register failed: {_life_err}")
                else:
                    logger.info(f"indexing-mode: coder resumed: {resume_result}")
            except Exception as e:
                logger.error(f"indexing-mode: coder resume failed: {e} — MANUAL INTERVENTION NEEDED")

    return result_data


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
        # Parse ?device=VulkanN query param once for any endpoint that needs it.
        from urllib.parse import urlparse, parse_qs
        _parsed = urlparse(self.path)
        _path = _parsed.path
        _qs = parse_qs(_parsed.query)
        _device = (_qs.get("device") or [None])[0]

        if _path == "/version":
            # Three-way version check: clients compare their expected
            # version against this value and warn on drift.
            self._send_json(200, {"version": DAEMON_VERSION, "component": "daemon"})
        elif _path == "/health":
            stats = _supervisor_singleton.stats()
            all_healthy = all(
                s["last_health_ok"] > time.time() - _HEALTH_INTERVAL * 2
                for s in stats
            ) if stats else False
            _legacy_busy = _rag_gpu_busy_current()
            self._send_json(200, {
                "status": "ready" if all_healthy else "degraded",
                "training_locked": _training_locked(),
                "instances": stats,
                "arbiter_busy": _legacy_busy,       # legacy alias
                "rag_gpu_busy": _legacy_busy,       # legacy alias (= default device)
                "gpu_busy": gpu_busy_snapshot(),    # per-device dict
            })
        elif _path == "/rag-route":
            if _device is not None:
                _busy = gpu_busy_current(_device)
            else:
                _busy = _rag_gpu_busy_current()
            self._send_json(200, {
                "device": _device,
                "route": "cpu" if _busy else "gpu",
                "arbiter_busy": _busy,       # legacy alias
                "rag_gpu_busy": _busy,
            })
        elif _path == "/stats":
            self._send_json(200, {"instances": _supervisor_singleton.stats()})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        try:
            cl = self.headers.get("Content-Length")
            if cl is None:
                length = 0
            else:
                length = int(cl)
            body = json.loads(self.rfile.read(length)) if length else {}
        except (ValueError, UnicodeDecodeError, OverflowError):
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
        elif self.path == "/gpu-busy":
            # Per-device flag update. Used by callers whose work isn't an
            # llm-generate (audio tools, future GPU workloads) but still
            # wants to gate siblings on the same physical GPU.
            device = body.get("device", "")
            state = body.get("state", "")
            if not device:
                self._send_json(400, {"error": "device required (e.g. Vulkan1)"})
            elif state == "set":
                gpu_busy_set(device)
                self._send_json(200, {"device": device, "busy": True})
            elif state == "clear":
                gpu_busy_clear(device)
                self._send_json(200, {"device": device, "busy": False})
            else:
                self._send_json(400, {"error": "state must be 'set' or 'clear'"})
        elif self.path == "/suspend":
            name = body.get("name", "")
            if not name:
                self._send_json(400, {"error": "name required (e.g. 'coder')"})
            else:
                result = _supervisor_singleton.suspend(name)
                self._send_json(200, result)
        elif self.path == "/resume":
            name = body.get("name", "")
            if not name:
                self._send_json(400, {"error": "name required (e.g. 'coder')"})
            else:
                result = _supervisor_singleton.resume(name)
                self._send_json(200, result)
        elif self.path == "/indexing-mode":
            # Full GPU-dedicated reindex. The daemon orchestrates everything:
            # suspend coder → tell shim to reindex on freed GPU → resume coder.
            # Blocks until complete. Only the daemon touches GPU allocation.
            import threading
            import traceback
            result = {"error": "not started"}
            def _run():
                nonlocal result
                try:
                    result = _run_indexing_mode()
                except Exception as e:
                    tb = traceback.format_exc()
                    logger.error(f"indexing-mode: _run_indexing_mode raised: {tb}")
                    result = {"error": f"indexing-mode crashed: {type(e).__name__}: {e}"}
            t = threading.Thread(target=_run)
            t.start()
            t.join(timeout=580)  # slightly under the client's 600s timeout
            if t.is_alive():
                result = {"error": "indexing mode timed out (580s)"}
            self._send_json(200, result)
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

    # Pre-boot topology assertion: catch environment problems at startup
    # instead of letting them silently propagate into mid-operation OOMs.
    try:
        _supervisor_singleton.assert_topology_ready()
    except RuntimeError as _topo_err:
        logger.error(f"daemon: topology assertion failed — refusing to start:\n  {_topo_err}")
        try:
            os.unlink(PID_FILE)
        except OSError:
            pass
        sys.exit(2)

    # Wrap thread targets so any exception is logged with traceback. Bare
    # threading.Thread(target=fn) silently discards exceptions when fn
    # raises — this is exactly how the original "not started" indexing-mode
    # bug went unnoticed for so long. Every thread must surface its own
    # failure or it might as well not run.
    def _logged_thread(name: str, fn):
        def _wrapped():
            try:
                fn()
            except Exception:
                import traceback
                logger.error(f"daemon thread {name!r} crashed:\n{traceback.format_exc()}")
        return threading.Thread(target=_wrapped, daemon=True, name=name)

    _logged_thread("supervisor-init", _supervisor_singleton.ensure_all_running).start()
    _logged_thread("supervisor-health", _health_loop).start()

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
