"""Supervisor — owns llama-server processes.

Adopts externally-launched survivors, spawns missing ones, restarts
unhealthy ones, fires LIFESAVER on failures. All stateless probing /
topology assertion lives in supervisor_helpers.py; this file is the
orchestrator.
"""
from __future__ import annotations

import os
import signal
import subprocess
import threading
import time

from ._boot import ENV, logger, _training_locked
from .instance_spec import InstanceSpec, _default_instances
from . import supervisor_helpers as H


class Supervisor:
    """Owns llama-server processes. Adopts externally-launched survivors,
    spawns missing ones, restarts unhealthy ones, fires LIFESAVER on
    failures."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._instances: dict[str, InstanceSpec] = {}
        self._bin = ENV.require("HME_LLAMA_SERVER_BIN")
        self._log_dir = ENV.require("HME_LLAMA_LOG_DIR")
        self._health_timeout_s = ENV.require_float("HME_LLAMA_HEALTH_TIMEOUT")
        self._min_restart_interval = ENV.require_float("HME_LLAMA_RESTART_COOLDOWN")

    # Config + query
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

    def assert_topology_ready(self) -> None:
        self.configure()
        H.assert_topology_ready(list(self._instances.values()), self._health_timeout_s)

    # Spawn
    def _spawn(self, spec: InstanceSpec, *, bypass_cooldown: bool = False) -> bool:
        """Launch spec as a detached subprocess. Enforces full-offload invariant.

        bypass_cooldown=True skips the crash-loop cooldown gate. Use ONLY
        for planned restarts (e.g. indexing-mode resume) where we just
        intentionally killed the process.
        """
        # Single-writer invariant: only llamacpp_daemon may spawn llama-server.
        # Pass the package name explicitly — __file__ would now resolve to
        # `supervisor.py` (post-split), which doesn't match the registered
        # owner stem "llamacpp_daemon" in lifecycle_writers._OWNERS.
        try:
            from server.lifecycle_writers import assert_writer
            assert_writer("llama-server", "llamacpp_daemon")
        except ImportError:  # silent-ok: lifecycle_writers optional when running standalone
            pass
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
            logger.warning(
                f"supervisor: {spec.name} lora missing: {spec.lora_path} — "
                f"launching without lora"
            )
            spec.lora_path = None
        if spec.n_gpu_layers != 999:
            H.fire_offload_violation(
                spec, f"n_gpu_layers={spec.n_gpu_layers} (must be 999 for full offload)",
            )
            return False
        fits, reason = H.check_gpu_fits(spec, self._health_timeout_s)
        if not fits:
            H.fire_offload_violation(spec, reason)
            return False

        now = time.time()
        if (not bypass_cooldown and spec.last_start > 0
                and (now - spec.last_start) < self._min_restart_interval):
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
            spec.process = subprocess.Popen(
                argv, stdin=open("/dev/null", "rb"),
                stdout=stdout, stderr=stdout,
                start_new_session=True, close_fds=True,
            )
            spec.last_start = now
            spec.restart_count += 1
            return True
        except Exception as e:
            logger.exception(f"supervisor: spawn {spec.name} failed: {e}")
            return False

    # Suspend / resume (indexing-mode orchestration)
    def suspend(self, name: str) -> dict:
        """Suspend: kill process + prevent auto-restart.

        Fail-fast contract: returns {"error": ...} unless EVERY process
        listening on spec.port has been terminated. Guards against the
        duplicate-llama-server race where a competing supervisor's spawn
        would leave the port held after suspend claimed success.
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

            for _sweep in range(5):
                pid = H.find_pid_on_port(spec.port)
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
                    except ProcessLookupError:  # silent-ok: died between SIGTERM and SIGKILL
                        pass
                    except OSError as e:
                        return {"error": f"{name}: SIGKILL PID {pid} failed: {e}"}
                killed_pids.append(pid)
            else:
                pid = H.find_pid_on_port(spec.port)
                return {"error": f"{name}: port {spec.port} still bound by PID {pid} after 5 kill sweeps"}

            logger.info(
                f"supervisor: {name} suspended "
                f"({'PIDs terminated: ' + str(killed_pids) if killed_pids else 'no process found'})"
            )
            return {"name": name, "suspended": True, "killed_pids": killed_pids}

    def resume(self, name: str) -> dict:
        """Resume a suspended instance: clear flag + spawn immediately.

        bypass_cooldown=True: suspend+resume is always planned (indexing
        orchestration), not a crash. Honoring the crash cooldown here
        would leave the instance down for HME_LLAMA_RESTART_COOLDOWN
        seconds after every reindex.
        """
        with self._lock:
            spec = self._instances.get(name)
            if not spec:
                return {"error": f"unknown instance: {name}"}
            spec.suspended = False
            ok = self._spawn(spec, bypass_cooldown=True)
            logger.info(f"supervisor: {name} resumed (spawned={ok})")
            return {"name": name, "suspended": False, "spawned": ok}

    # Orchestration loops
    def ensure_all_running(self) -> dict[str, str]:
        """Spawn any instance that isn't serving /health=ok. Adopts
        externally-launched survivors. Skipped while training lock held
        or suspended."""
        if _training_locked():
            return {"status": "training_locked"}
        self.configure()
        result: dict[str, str] = {}
        with self._lock:
            for spec in self._instances.values():
                if spec.suspended:
                    result[spec.name] = "suspended"
                elif H.probe_health(spec, self._health_timeout_s):
                    spec.last_health_ok = time.time()
                    result[spec.name] = "healthy"
                elif spec.process is not None and spec.process.poll() is None:
                    result[spec.name] = "starting"
                elif H.is_listening(spec, self._health_timeout_s):
                    result[spec.name] = "loading"
                else:
                    ok = self._spawn(spec)
                    result[spec.name] = "spawned" if ok else "spawn_failed"
        return result

    def health_tick(self) -> dict[str, dict]:
        """Probe all instances; restart any unhealthy (with cooldown)."""
        if _training_locked():
            return {"status": "training_locked"}
        out: dict[str, dict] = {}
        with self._lock:
            for spec in self._instances.values():
                if spec.suspended:
                    out[spec.name] = {"healthy": False, "suspended": True}
                    continue
                if H.probe_health(spec, self._health_timeout_s):
                    spec.last_health_ok = time.time()
                    out[spec.name] = {
                        "healthy": True, "url": spec.base_url(),
                        "restart_count": spec.restart_count,
                        "age_s": round(time.time() - spec.last_start, 1)
                                 if spec.last_start else None,
                    }
                    continue
                if H.is_listening(spec, self._health_timeout_s):
                    out[spec.name] = {
                        "healthy": False, "loading": True,
                        "url": spec.base_url(),
                        "restart_count": spec.restart_count,
                    }
                    continue
                logger.warning(f"supervisor: {spec.name} unhealthy — attempting restart")
                spawn_ok = self._spawn(spec)
                out[spec.name] = {
                    "healthy": False, "url": spec.base_url(),
                    "restart_attempted": True, "spawn_ok": spawn_ok,
                    "restart_count": spec.restart_count,
                }
                if not spawn_ok:
                    try:
                        from server import context as _ctx
                        _ctx.register_critical_failure(
                            "llamacpp_supervisor",
                            f"{spec.name} ({spec.base_url()}) health failed and restart "
                            f"could not be attempted (cooldown or spawn error)",
                            severity="CRITICAL",
                        )
                    except Exception as _life_err:
                        logger.debug(f"supervisor: LIFESAVER register failed: {_life_err}")
        return out

    def stats(self) -> list[dict]:
        with self._lock:
            return [
                {
                    "name": s.name, "url": s.base_url(),
                    "device": s.device, "alias": s.alias,
                    "model": os.path.basename(s.model_path),
                    "lora": os.path.basename(s.lora_path) if s.lora_path else None,
                    "last_start": s.last_start,
                    "last_health_ok": s.last_health_ok,
                    "restart_count": s.restart_count,
                    "pid": (s.process.pid if s.process and s.process.poll() is None else None),
                }
                for s in self._instances.values()
            ]
