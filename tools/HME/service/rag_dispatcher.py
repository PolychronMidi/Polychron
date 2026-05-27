"""RAG engine setup -- model loading, GPU/CPU routing, reranker adapters.

Extracted from hme_http.py. Contains:
  _RagDispatcher    -- routes embedding calls to GPU or CPU mirror
  _MxbaiRerankerAdapter -- wraps mxbai-rerank-base-v2 as CrossEncoder API
  _load_engines     -- background thread that loads all models + starts indexing
  _ensure_llamacpp_daemon / _ensure_vram_monitor -- daemon launchers
"""
import os
import sys
import json
import time
import logging
import threading
import subprocess

_tool_root = os.path.dirname(os.path.abspath(__file__))
if _tool_root not in sys.path:
    sys.path.insert(0, _tool_root)

from hme_env import ENV  # noqa: E402

logger = logging.getLogger("HME.http")

PROJECT_ROOT = ENV.require("PROJECT_ROOT")
PROJECT_DB = ENV.require("HME_RAG_DB_PATH")
GLOBAL_DB = ENV.require("HME_GLOBAL_KB_PATH")
MODEL_NAME = ENV.require("HME_MODEL_TEXT_EMBED")
MODEL_BACKEND = ENV.require("HME_RAG_BACKEND")

_engine_ready = threading.Event()
_project_engine = None
_global_engine = None
_shared_model_cpu = None
_shared_code_model_cpu = None
_shared_reranker_cpu = None
_lib_engines = {}


# RAG routing: GPU vs CPU mirror
_LLAMACPP_DAEMON_URL = ENV.require("HME_LLAMACPP_DAEMON_URL")
_rag_route_cache = {"route": "gpu", "ts": 0.0}
_rag_route_ttl_s = 0.1
_rag_route_fail_count = 0




class _RagDispatcher:
    """Queue-aware dispatcher over a (GPU, CPU) worker pair, with optional
    VramManager-backed active offload.

    Acquire semantics:
      1. Prefer GPU when the daemon reports the RAG GPU is idle AND the
         managed model's GPU instance is currently resident (ManagedModel.
         gpu_instance is not None) AND the GPU worker's slot is free.
      2. Before handing out the GPU instance, call VramManager.request_room()
         to guarantee headroom. If that fails (not enough free VRAM even
         after offloading lower-priority residents), fall through to CPU.
      3. Fall back to the CPU mirror when the GPU is contended, offloaded,
         or the GPU-side semaphore is already held by another in-flight
         RAG call.
      4. When both slots are held, the caller blocks on a condition variable
         and is woken by the next release. Re-polls the daemon flag and
         managed-model state every second in case arbiter finished or
         VramManager reloaded the GPU instance mid-wait.

    Both workers get a semaphore with one slot. When multiple concurrent
    encode/predict calls arrive, they stack across the two workers (first
    takes GPU, second takes CPU) and additional callers queue on the CV.

    If only one worker exists (CPU load failed, or GPU-only mode), the
    dispatcher degrades to that single worker with straightforward blocking
    acquire. Full interface compatibility with SentenceTransformer /
    CrossEncoder -- .encode, .predict, .device, and arbitrary attribute
    delegation via __getattr__.

    managed_model (optional): the VramManager.ManagedModel registered for
    this instance. When present, the dispatcher reads ManagedModel.
    gpu_instance on every acquire (so offload/reload take effect immediately)
    and calls VramManager.request_room() for pressure-based offload. When
    None, behavior is the static two-instance dispatcher (old shape).
    """

    # GPU:CPU speed ratio for embedding on this hardware (M40 fp16 storage
    _GPU_CPU_OVERFLOW_THRESHOLD = 3

    def __init__(
        self,
        gpu_instance,
        cpu_instance,
        label: str,
        managed_model=None,
        vram_manager=None,
    ):
        # Critical: when a managed_model is provided, DO NOT store the
        self._gpu = None if managed_model is not None else gpu_instance
        self._cpu = cpu_instance
        self._label = label
        self._mm = managed_model      # dynamic GPU-instance source when set
        self._vram = vram_manager
        self._gpu_sem = threading.Semaphore(1) if self._current_gpu() is not None else None
        self._cpu_sem = threading.Semaphore(1) if cpu_instance is not None else None
        self._cv = threading.Condition()
        self._gpu_waiting = 0  # requests queued for GPU (waiting on sem)
        try:
            ratio = ENV.optional_int("HME_RAG_GPU_CPU_RATIO", self._GPU_CPU_OVERFLOW_THRESHOLD)
            self._overflow_threshold = max(1, ratio)
        except Exception:
            # silent-ok: optional fallback path.
            self._overflow_threshold = self._GPU_CPU_OVERFLOW_THRESHOLD

    def _current_gpu(self):
        """Resolve the GPU instance at call time. With a managed model, the
        source is ManagedModel.gpu_instance (may flip to None when offloaded).
        Without, it's the static pointer given at construction."""
        if self._mm is not None:
            return self._mm.gpu_instance
        return self._gpu

    def _acquire(self):
        """Return (instance, release_fn). Blocks until a worker is free.

        GPU is faster than CPU for embedding, so we prefer queuing on GPU
        over immediately overflowing to CPU. Only overflow to CPU when the
        GPU queue depth exceeds the GPU:CPU speed ratio threshold -- at
        that point, waiting for GPU would be slower than using CPU.

        route="cpu" (arbiter generating or low VRAM) gates GPU off entirely
        and all requests go to CPU regardless of queue depth.
        """
        # Degraded modes (single worker). Re-check every call since a
        # managed model can flip between resident / offloaded.
        cpu = self._cpu
        gpu_at_start = self._current_gpu()
        if gpu_at_start is None and cpu is None:
            raise RuntimeError(
                f"_RagDispatcher({self._label}): both GPU and CPU instances are None -- "
                f"cannot serve any requests. Check model loading in _load_engines."
            )
        if gpu_at_start is None and cpu is not None:
            self._cpu_sem.acquire()
            return cpu, self._release_cpu
        if cpu is None and gpu_at_start is not None:
            self._gpu_sem.acquire()
            return gpu_at_start, self._release_gpu

        with self._cv:
            while True:
                gpu = self._current_gpu()
                from rag_engines import _rag_route
                gpu_ok = gpu is not None and _rag_route() == "gpu"

                if gpu_ok and self._gpu_sem is not None:
                    if self._gpu_sem.acquire(blocking=False):
                        # Got GPU immediately -- pressure check then use it.
                        if self._vram is not None and self._mm is not None:
                            ok = self._vram.request_room(self._mm.headroom_gb, caller=self._mm)
                            if not ok:
                                self._gpu_sem.release()
                                self._cv.notify_all()
                            else:
                                return gpu, self._release_gpu
                        else:
                            return gpu, self._release_gpu
                    elif self._gpu_waiting < self._overflow_threshold:
                        # GPU sem taken but queue isn't deep enough to
                        self._gpu_waiting += 1
                        try:
                            while True:
                                self._cv.wait(timeout=1.0)
                                # Re-check: GPU may have been offloaded or
                                # route may have flipped to "cpu" while waiting
                                gpu = self._current_gpu()
                                from rag_engines import _rag_route as _rr2
                                if gpu is None or _rr2() != "gpu":
                                    break  # bail to overflow path below
                                if self._gpu_sem.acquire(blocking=False):
                                    if self._vram is not None and self._mm is not None:
                                        ok = self._vram.request_room(self._mm.headroom_gb, caller=self._mm)
                                        if not ok:
                                            self._gpu_sem.release()
                                            self._cv.notify_all()
                                            break  # bail to overflow
                                    return gpu, self._release_gpu
                        finally:
                            self._gpu_waiting -= 1
                    # else: GPU queue deep enough -- fall through to CPU overflow

                # Overflow to CPU -- either route="cpu", VRAM pressure,
                # or GPU queue exceeds threshold
                if self._cpu_sem is not None and self._cpu_sem.acquire(blocking=False):
                    return cpu, self._release_cpu
                # Both paths unavailable -- wait for any release
                self._cv.wait(timeout=1.0)

    def _release_gpu(self):
        with self._cv:
            if self._gpu_sem is not None:
                self._gpu_sem.release()
            self._cv.notify_all()

    def _release_cpu(self):
        with self._cv:
            if self._cpu_sem is not None:
                self._cpu_sem.release()
            self._cv.notify_all()

    def encode(self, *args, **kwargs):
        inst, release = self._acquire()
        try:
            return inst.encode(*args, **kwargs)
        finally:
            release()

    def predict(self, *args, **kwargs):
        inst, release = self._acquire()
        try:
            return inst.predict(*args, **kwargs)
        finally:
            release()

    @property
    def device(self):
        inst = self._current_gpu() or self._cpu
        return getattr(inst, "device", "unknown")

    def __getattr__(self, name):
        # Delegate non-dispatch attributes (tokenizer, max_seq_length, etc.)
        mm = self.__dict__.get("_mm")
        gpu = mm.gpu_instance if mm is not None else self.__dict__.get("_gpu")
        inst = gpu if gpu is not None else self.__dict__.get("_cpu")
        if inst is None:
            raise AttributeError(name)
        return getattr(inst, name)
_lib_engines: dict = {}  # key = lib_rel path


