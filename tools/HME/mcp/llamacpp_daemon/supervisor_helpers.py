"""Stateless helpers extracted from _Supervisor.

Functions here take primitives or InstanceSpec and never touch
supervisor internal state (no _lock, no _instances). Keeps the
Supervisor class focused on orchestration.
"""
from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.request

from ._boot import logger
from .instance_spec import InstanceSpec


def vulkan_to_cuda_index(device: str) -> int | None:
    """Vulkan1 = CUDA 0, Vulkan2 = CUDA 1. Unknown → None (invariant violation)."""
    if device == "Vulkan1":
        return 0
    if device == "Vulkan2":
        return 1
    return None


def gpu_free_mb(cuda_idx: int) -> int | None:
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.free",
             "--format=csv,noheader,nounits", f"--id={cuda_idx}"],
            stderr=subprocess.DEVNULL, timeout=3,
        )
        return int(out.decode().strip().splitlines()[0])
    except Exception as _gpu_err:
        logger.warning(f"supervisor: nvidia-smi probe failed for cuda:{cuda_idx}: {_gpu_err}")
        return None


def probe_health(spec: InstanceSpec, health_timeout_s: float) -> bool:
    try:
        with urllib.request.urlopen(
            f"{spec.base_url()}/health", timeout=health_timeout_s
        ) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(body)
            except ValueError:
                data = {}
            return resp.status == 200 and data.get("status") == "ok"
    except Exception as _probe_err:
        logger.debug(
            f"supervisor: /health probe failed for {spec.base_url()}: "
            f"{type(_probe_err).__name__}: {_probe_err}"
        )
        return False


def is_listening(spec: InstanceSpec, health_timeout_s: float) -> bool:
    """Distinguish 'loading' (port bound but /health not ok) from 'truly dead'.
    Any HTTP response — 200, 503 with status=loading, etc. — counts as
    listening. Only ConnectionRefused / timeout counts as dead."""
    try:
        urllib.request.urlopen(
            f"{spec.base_url()}/health", timeout=health_timeout_s
        ).read()
        return True
    except urllib.error.HTTPError:
        return True
    except Exception as _listen_err:
        logger.debug(
            f"supervisor: is_listening probe failed for {spec.base_url()}: "
            f"{type(_listen_err).__name__}: {_listen_err}"
        )
        return False


def find_pid_on_port(port: int) -> int | None:
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


def check_gpu_fits(spec: InstanceSpec, health_timeout_s: float) -> tuple[bool, str]:
    """Return (True, '') if model + KV cache fits in assigned GPU's free VRAM
    with headroom, else (False, reason). Conservative: model file size
    plus ctx_size * 0.5 MB KV budget plus 256 MB headroom.

    Credits back model_mb if the port is already bound — the existing
    loading process is OCCUPYING that VRAM, not competing for it, so
    we don't double-count it. Without this credit, self-respawn during
    model load fires a false offload-invariant CRITICAL.
    """
    cuda_idx = vulkan_to_cuda_index(spec.device)
    if cuda_idx is None:
        return False, f"unknown Vulkan device {spec.device!r} — cannot guarantee full offload"
    free_mb = gpu_free_mb(cuda_idx)
    if free_mb is None:
        return False, f"could not probe free VRAM on cuda:{cuda_idx} ({spec.device})"
    try:
        model_mb = os.path.getsize(spec.model_path) // (1024 * 1024)
    except OSError as _stat_err:
        return False, f"could not stat model file: {_stat_err}"
    kv_mb = (spec.ctx_size * 512) // 1024
    headroom_mb = 256
    needed_mb = model_mb + kv_mb + headroom_mb
    if is_listening(spec, health_timeout_s):
        free_mb += model_mb
    if needed_mb > free_mb:
        return False, (
            f"won't fit on {spec.device} (cuda:{cuda_idx}): "
            f"need {needed_mb} MB (model {model_mb} + kv {kv_mb} + headroom {headroom_mb}), "
            f"only {free_mb} MB free"
        )
    return True, ""


def fire_offload_violation(spec: InstanceSpec, reason: str) -> None:
    """ARCHITECTURE INVARIANT VIOLATION: model would offload to CPU.

    Each model owns its GPU end-to-end. Partial offload is a hard failure
    — never a graceful degradation. Registers a CRITICAL LIFESAVER so
    the operator knows to free the assigned GPU.
    """
    msg = (
        f"GPU offload invariant violated: {spec.name} "
        f"({os.path.basename(spec.model_path)}) on {spec.device} — {reason}. "
        f"Each HME model OWNS its GPU. Free the assigned device and restart the daemon."
    )
    logger.error(f"supervisor: {msg}")
    try:
        from server import context as _ctx
        _ctx.register_critical_failure(
            f"llamacpp_offload_invariant({spec.name})", msg, severity="CRITICAL",
        )
    except Exception as _life_err:
        logger.error(f"supervisor: failed to register LIFESAVER for offload violation: {_life_err}")


def assert_topology_ready(instances: list[InstanceSpec], health_timeout_s: float) -> None:
    """Fail-fast pre-boot assertion: refuse to start if the GPU/port
    environment isn't what the topology declares. Raises RuntimeError
    with a concrete remediation message on any violation.

    Guards against: a prior daemon died uncleanly, leaving its llama-
    server children running. A fresh daemon then ran its health loop
    against the orphans, mis-attributed their VRAM usage, and the next
    indexing-mode crashed on OOM. Catching it at boot turns a mysterious
    mid-operation OOM into a readable startup error.
    """
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
        raise RuntimeError("daemon: nvidia-smi timed out after 3s — driver hung?")

    for spec in instances:
        cuda_idx = vulkan_to_cuda_index(spec.device)
        if cuda_idx is None:
            raise RuntimeError(
                f"daemon: {spec.name}.device={spec.device!r} does not map to a CUDA "
                f"index. Supported: Vulkan1=cuda:0, Vulkan2=cuda:1."
            )
        free = gpu_free_mb(cuda_idx)
        if free is None:
            raise RuntimeError(
                f"daemon: GPU{cuda_idx} ({spec.device}) unreachable via nvidia-smi. "
                f"Check driver / card connectivity."
            )
        fits, reason = check_gpu_fits(spec, health_timeout_s)
        if not fits:
            if not is_listening(spec, health_timeout_s):
                rogue = find_pid_on_port(spec.port)
                raise RuntimeError(
                    f"daemon: {spec.name} cannot fit on {spec.device} ({reason}). "
                    f"Port {spec.port} "
                    f"{'held by PID ' + str(rogue) if rogue else 'is free'}. "
                    f"Free the GPU (kill orphan llama-server / stop other CUDA "
                    f"process) then restart the daemon."
                )
        logger.info(
            f"daemon: topology OK — {spec.name} on {spec.device} "
            f"(free={free} MB, port={spec.port}"
            f"{', adopted' if is_listening(spec, health_timeout_s) else ''})"
        )
