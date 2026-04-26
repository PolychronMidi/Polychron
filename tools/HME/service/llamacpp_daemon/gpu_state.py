"""Per-GPU busy flags + RAG routing.

Each physical GPU (keyed by Vulkan tag) has its own busy flag. A generation
call flips the flag for the GPU its target instance lives on; callers on
that GPU (RAG stack on GPU0, audio models on GPU1, etc.) read the flag to
route GPU (idle) or CPU mirror (busy). Flag is device-based, not name-
based — so future instances scheduled onto either GPU participate without
code changes.

Watchdog: if any flag stays set for > WATCHDOG_S the daemon force-clears
with a warning so a bug in set/clear pairing can't permanently strand
callers on CPU.

Backcompat: the pre-existing single-flag API (_rag_gpu_busy,
arbiter_busy_set/clear, rag_route()) still works — it targets the "default"
device (arbiter's), so old callers behave exactly as before.
"""
from __future__ import annotations

import threading
import time

from ._boot import ENV, logger

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
