"""Per-GPU VRAM pressure manager with active offload/reload.

Used by hme_http (manages jina + bge-reranker on GPU0) and by the MCP
tools_analysis.perceptual_engines module (manages EnCodec + CLAP on GPU1).

Design contract:
  - Every "managed" model has a CPU mirror always resident. The GPU instance
    is optional and may be torn down to free VRAM under pressure.
  - Under pressure, lower-priority models are offloaded first. `priority=1`
    means first to go, higher numbers are sticky. LLMs (arbiter/coder) are
    NOT managed by this system — they're too large and the wins don't
    justify the eviction cost.
  - Reactive pressure: `request_room(...)` is called by a dispatcher before
    it uses the GPU instance. If free VRAM < needed headroom, offload lower-
    priority models until enough is free, OR fail (caller falls back to CPU).
  - Reload: `try_reload()` is called by a background poller when the
    daemon's per-GPU busy flag transitions busy→idle. Offloaded models are
    reloaded in priority DESC order (highest priority = most-used first).
  - All operations on a manager instance are serialized by a lock so
    concurrent dispatcher threads don't race each other into offload/reload
    pingpong.

Callbacks, not tight coupling:
  - A managed model carries a `gpu_factory` callable that constructs a fresh
    GPU instance when needed. The manager never knows the model's type — it
    just calls `m.gpu_factory()` on reload, and assigns to `m.gpu_instance`.
  - The dispatcher that owns a model sets `m.gpu_instance = None` during
    offload (after calling torch.cuda.empty_cache()). The manager doesn't
    touch the instance — only the pointer.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

logger = logging.getLogger("HME.vram")


@dataclass
class ManagedModel:
    """One small model registered with a VramManager.

    gpu_instance is mutable: set to a torch module when resident, None when
    offloaded. The field is the single source of truth for current state —
    dispatchers read it on every acquire, managers set it on offload/reload.
    """
    name: str                                    # human label for logging
    gpu_idx: int                                 # cuda device index
    priority: int                                # lower = first to offload
    size_gb: float                               # approximate resident VRAM cost
    headroom_gb: float                           # free VRAM required during op
    gpu_factory: Callable[[], Any]               # () -> new GPU instance
    gpu_instance: Optional[Any] = None           # current instance or None
    cpu_instance: Optional[Any] = None           # always resident, mirrored

    @property
    def offloaded(self) -> bool:
        return self.gpu_instance is None


class VramManager:
    """Orchestrates offload/reload for one GPU's managed models."""

    def __init__(self, gpu_idx: int):
        self.gpu_idx = gpu_idx
        self._models: list[ManagedModel] = []    # priority-asc
        self._lock = threading.Lock()

    def register(self, model: ManagedModel) -> None:
        if model.gpu_idx != self.gpu_idx:
            raise ValueError(
                f"VramManager(gpu_idx={self.gpu_idx}) cannot manage "
                f"{model.name} (gpu_idx={model.gpu_idx})"
            )
        with self._lock:
            self._models.append(model)
            self._models.sort(key=lambda m: m.priority)
            logger.info(
                f"registered {model.name} on cuda:{self.gpu_idx} "
                f"(priority={model.priority}, size={model.size_gb:.1f}GB, "
                f"headroom={model.headroom_gb:.1f}GB)"
            )

    def _free_gb(self) -> float:
        """Return free VRAM on this GPU in GB, or 0.0 if torch isn't available."""
        try:
            import torch
            free, _ = torch.cuda.mem_get_info(self.gpu_idx)
            return free / (1024 ** 3)
        except Exception as _e:
            logger.debug(f"_free_gb: mem_get_info failed ({type(_e).__name__}: {_e})")
            return 0.0

    def request_room(self, needed_gb: float, caller: Optional[ManagedModel] = None) -> bool:
        """Ensure `needed_gb` is free on this GPU. Offloads the lowest-priority
        resident models (excluding `caller`) until enough is free, or returns
        False if even after offloading everything it's still too tight.

        The caller is the ManagedModel that wants to run. It's excluded from
        offload candidates so a model doesn't offload itself. All other
        residents lower-priority-first get offloaded as needed.

        Returns True if the GPU now has >= needed_gb free.
        """
        with self._lock:
            free = self._free_gb()
            if free >= needed_gb:
                return True
            for m in self._models:  # ascending priority
                if m.offloaded:
                    continue
                if caller is not None and m.name == caller.name:
                    continue
                logger.info(
                    f"request_room(needed={needed_gb:.1f}GB, free={free:.1f}GB): "
                    f"offloading {m.name} (priority={m.priority})"
                )
                self._offload_locked(m)
                free = self._free_gb()
                if free >= needed_gb:
                    return True
            logger.warning(
                f"request_room({needed_gb:.1f}GB): exhausted — only {free:.1f}GB "
                f"free even after offloading all lower-priority residents"
            )
            return False

    def try_reload(self) -> list[str]:
        """Attempt to reload offloaded models in priority DESC order (highest
        first) as long as each one fits in currently-free VRAM plus its own
        headroom requirement. Called by a background poller on busy-flag
        transitions. Returns list of names reloaded this pass."""
        reloaded = []
        with self._lock:
            for m in reversed(self._models):  # priority desc
                if not m.offloaded:
                    continue
                free = self._free_gb()
                need = m.size_gb + m.headroom_gb
                if free < need:
                    logger.debug(
                        f"try_reload: {m.name} needs {need:.1f}GB "
                        f"(size={m.size_gb:.1f}+headroom={m.headroom_gb:.1f}), "
                        f"only {free:.1f}GB free — skipping"
                    )
                    continue
                try:
                    logger.info(f"try_reload: reloading {m.name} to cuda:{self.gpu_idx}")
                    m.gpu_instance = m.gpu_factory()
                    reloaded.append(m.name)
                except Exception as _e:
                    logger.warning(
                        f"try_reload: {m.name} factory failed ({type(_e).__name__}: {_e}) — "
                        f"staying offloaded"
                    )
        return reloaded

    def _offload_locked(self, m: ManagedModel) -> None:
        """Drop the GPU instance and free VRAM. Must hold self._lock."""
        if m.gpu_instance is None:
            return
        try:
            # Detach Python reference so torch can free the CUDA memory.
            m.gpu_instance = None
            import gc
            gc.collect()
            import torch
            torch.cuda.empty_cache()
        except Exception as _e:
            logger.warning(
                f"_offload_locked: cleanup for {m.name} raised "
                f"{type(_e).__name__}: {_e}"
            )

    def residents(self) -> list[str]:
        """Names of currently-resident models. Cheap introspection."""
        with self._lock:
            return [m.name for m in self._models if not m.offloaded]

    def offloaded_names(self) -> list[str]:
        """Names of currently-offloaded models."""
        with self._lock:
            return [m.name for m in self._models if m.offloaded]


def start_reload_poller(
    manager: VramManager,
    daemon_url: str,
    device_tag: str,
    poll_interval_s: float = 2.0,
) -> threading.Thread:
    """Spawn a daemon thread that watches the daemon's per-GPU busy flag for
    `device_tag` and calls `manager.try_reload()` on every busy→idle edge.

    Also calls `try_reload` once on start so any cold boot that happened to
    be offloaded can come back as soon as VRAM permits.
    """
    import json
    import time
    import urllib.request

    def _probe() -> bool:
        try:
            with urllib.request.urlopen(
                f"{daemon_url}/rag-route?device={device_tag}", timeout=0.4
            ) as resp:
                data = json.loads(resp.read())
                return bool(data.get("rag_gpu_busy", False))
        except Exception as _probe_err:
            logger.debug(f"rag-route probe failed: {type(_probe_err).__name__}: {_probe_err}")
            return False

    def _loop():
        try:
            manager.try_reload()
        except Exception as _e:
            logger.debug(f"reload poller: initial try_reload failed ({_e})")
        last_busy = False
        while True:
            try:
                busy = _probe()
                if last_busy and not busy:
                    reloaded = manager.try_reload()
                    if reloaded:
                        logger.info(
                            f"reload poller ({device_tag}): busy→idle "
                            f"→ reloaded {reloaded}"
                        )
                last_busy = busy
            except Exception as _e:
                logger.debug(f"reload poller ({device_tag}) iteration: {_e}")
            time.sleep(poll_interval_s)

    t = threading.Thread(target=_loop, name=f"vram-reload-{device_tag}", daemon=True)
    t.start()
    return t
