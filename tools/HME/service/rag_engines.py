"""RAG engine setup — model loading, GPU/CPU routing, reranker adapters.

Extracted from hme_http.py. Contains:
  _RagDispatcher    — routes embedding calls to GPU or CPU mirror
  _MxbaiRerankerAdapter — wraps mxbai-rerank-base-v2 as CrossEncoder API
  _load_engines     — background thread that loads all models + starts indexing
  _ensure_llamacpp_daemon / _ensure_vram_monitor — daemon launchers
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
# When the arbiter is actively processing a request on the shared GPU, we
# route jina / bge-reranker work to the CPU mirrors to avoid contending for
# compute. The llamacpp_daemon exposes /rag-route which answers "gpu" or
# "cpu" based on its in-memory _arbiter_busy flag (set around every arbiter
# request dispatch). We cache the last answer for 100 ms so bursty RAG calls
# don't DoS the daemon with HTTP probes.
_LLAMACPP_DAEMON_URL = ENV.require("HME_LLAMACPP_DAEMON_URL")
_rag_route_cache = {"route": "gpu", "ts": 0.0}
_rag_route_ttl_s = 0.1
_rag_route_fail_count = 0


def _rag_route() -> str:
    """Return 'gpu' or 'cpu' for the next RAG op on the RAG GPU.

    Queries the daemon's per-device /rag-route?device=<RAG's Vulkan tag>.
    Falls back to 'gpu' if the daemon is unreachable or no CPU mirror exists.
    Cache-gated to ~100ms so a single tool call's batch of encode/rerank calls
    doesn't spam the daemon.
    """
    global _rag_route_fail_count
    if _shared_code_model_cpu is None and _shared_reranker_cpu is None:
        return "gpu"
    now = time.time()
    if now - _rag_route_cache["ts"] < _rag_route_ttl_s:
        return _rag_route_cache["route"]
    try:
        import urllib.request as _ur
        # Ask for RAG's specific Vulkan device; the daemon returns whether
        # that device currently has an in-flight generation.
        _tag = ENV.require("HME_RAG_VULKAN")
        with _ur.urlopen(
            f"{_LLAMACPP_DAEMON_URL}/rag-route?device={_tag}", timeout=0.2,
        ) as resp:
            data = json.loads(resp.read())
            route = data["route"]
        if _rag_route_fail_count > 0:
            logger.info(f"_rag_route: daemon reconnected after {_rag_route_fail_count} failures")
            _rag_route_fail_count = 0
    except Exception as _e:
        _rag_route_fail_count += 1
        # Escalate to WARNING every 10 failures — persistent daemon outage
        # means no CPU fallback during arbiter generation (GPU contention risk)
        if _rag_route_fail_count <= 3 or _rag_route_fail_count % 10 == 0:
            _log = logger.warning if _rag_route_fail_count >= 3 else logger.debug
            _log(
                f"_rag_route: daemon unreachable ({type(_e).__name__}), "
                f"defaulting to gpu (consecutive failures: {_rag_route_fail_count})"
            )
        route = "gpu"
    _rag_route_cache["route"] = route
    _rag_route_cache["ts"] = now
    return route


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
    CrossEncoder — .encode, .predict, .device, and arbitrary attribute
    delegation via __getattr__.

    managed_model (optional): the VramManager.ManagedModel registered for
    this instance. When present, the dispatcher reads ManagedModel.
    gpu_instance on every acquire (so offload/reload take effect immediately)
    and calls VramManager.request_room() for pressure-based offload. When
    None, behavior is the static two-instance dispatcher (old shape).
    """

    # GPU:CPU speed ratio for embedding on this hardware (M40 fp16 storage
    # vs multi-core CPU). Only overflow to CPU when GPU queue is deeper
    # than this — sequential GPU is faster than parallel CPU until then.
    # Measured empirically: M40 ~3x faster than Ryzen 7950X for bge-code
    # fp16 encode batches. Tune via HME_RAG_GPU_CPU_RATIO in .env.
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
        # gpu_instance on self. The ManagedModel owns the single GPU
        # reference so VramManager offload can actually release VRAM when
        # it nulls ManagedModel.gpu_instance. Holding a duplicate pointer
        # here would pin the torch module and silently defeat offload.
        # This is enforced by the `no-direct-shared-model-encode` invariant.
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
        GPU queue depth exceeds the GPU:CPU speed ratio threshold — at
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
                f"_RagDispatcher({self._label}): both GPU and CPU instances are None — "
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
                gpu_ok = gpu is not None and _rag_route() == "gpu"

                if gpu_ok and self._gpu_sem is not None:
                    if self._gpu_sem.acquire(blocking=False):
                        # Got GPU immediately — pressure check then use it.
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
                        # justify CPU overflow — wait for GPU. Sequential
                        # GPU is faster than parallel CPU until the queue
                        # exceeds the speed ratio.
                        self._gpu_waiting += 1
                        try:
                            while True:
                                self._cv.wait(timeout=1.0)
                                # Re-check: GPU may have been offloaded or
                                # route may have flipped to "cpu" while waiting
                                gpu = self._current_gpu()
                                if gpu is None or _rag_route() != "gpu":
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
                    # else: GPU queue deep enough — fall through to CPU overflow

                # Overflow to CPU — either route="cpu", VRAM pressure,
                # or GPU queue exceeds threshold
                if self._cpu_sem is not None and self._cpu_sem.acquire(blocking=False):
                    return cpu, self._release_cpu
                # Both paths unavailable — wait for any release
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
        # to whichever instance exists. Prefer GPU when resident for config
        # consistency, fall back to CPU when offloaded or GPU-less.
        mm = self.__dict__.get("_mm")
        gpu = mm.gpu_instance if mm is not None else self.__dict__.get("_gpu")
        inst = gpu if gpu is not None else self.__dict__.get("_cpu")
        if inst is None:
            raise AttributeError(name)
        return getattr(inst, name)
_lib_engines: dict = {}  # key = lib_rel path


class _MxbaiRerankerAdapter:
    """Adapter exposing CrossEncoder.predict(pairs) on top of MxbaiRerankV2.

    mxbai-rerank-v2 is a Qwen2-based listwise reranker, NOT a standard
    CrossEncoder. Loading it via sentence_transformers.CrossEncoder leaves
    the score head randomly initialized (silent corruption — outputs look
    plausible but are noise). The official mxbai_rerank library loads the
    real score head and exposes .rank(query, docs).

    Engine search code feeds pairs as [(query, doc1), (query, doc2), ...]
    where the query is constant across the batch. We split, call .rank(),
    then map results back to input order. Returns raw logits (~[-10, +10])
    so downstream batch min-max normalization works the same as bge-reranker.
    """

    def __init__(self, model_name: str, device: str, dtype=None):
        from mxbai_rerank import MxbaiRerankV2
        kwargs = {"device": device}
        if dtype is not None:
            kwargs["torch_dtype"] = dtype
        self._inner = MxbaiRerankV2(model_name, **kwargs)
        self._device = device

    @property
    def device(self):
        return self._device

    def predict(self, pairs, show_progress_bar=False, **kwargs):
        if not pairs:
            return []
        query = pairs[0][0]
        for q, _ in pairs:
            if q != query:
                raise ValueError("_MxbaiRerankerAdapter.predict requires constant query across pairs")
        docs = [d for _, d in pairs]
        results = self._inner.rank(query, docs, return_documents=False, top_k=len(docs))
        scores = [0.0] * len(docs)
        for r in results:
            scores[r.index] = float(r.score)
        return scores

    def __getattr__(self, name):
        return getattr(self._inner, name)


CODE_MODEL_NAME = ENV.require("HME_MODEL_CODE_EMBED")
RERANKER_NAME = ENV.require("HME_MODEL_RERANKER")

# Initialise stores with paths before any request can arrive
from hme_http_store import init_store
init_store(PROJECT_ROOT)


def _ensure_llamacpp_daemon():
    """Start the llama.cpp persistence daemon if not already running.

    Owns the llama-server supervisor (spawns/adopts llama-server instances
    for arbiter and coder), the arbiter-busy flag that drives RAG CPU/GPU
    routing, and the generation proxy for legacy callers.
    """
    import urllib.request as _urlreq
    # Post-R98 split: daemon is a package at mcp/llamacpp_daemon/ rather
    # than a single .py file. Presence check points at the package dir.
    _mcp_dir = os.path.dirname(os.path.abspath(__file__))
    _daemon_pkg = os.path.join(_mcp_dir, "llamacpp_daemon")
    if not os.path.isdir(_daemon_pkg):
        return
    try:
        with _urlreq.urlopen(_urlreq.Request("http://127.0.0.1:7735/health"), timeout=1) as _r:
            if _r.status == 200:
                return  # already running
    except Exception as _e:
        logger.debug(f"_ensure_llamacpp_daemon: daemon probe failed ({type(_e).__name__}), will spawn")
    import subprocess
    env = os.environ.copy()  # env-ok: subprocess needs inherited env
    env["PROJECT_ROOT"] = PROJECT_ROOT
    try:
        subprocess.Popen(
            ["python3", "-m", "llamacpp_daemon"],
            cwd=_mcp_dir,
            env=env, start_new_session=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        logger.info("llamacpp daemon started (port 7735)")
    except Exception as e:
        logger.warning(f"llamacpp daemon start failed: {e}")


def _ensure_vram_monitor():
    """Start the VRAM monitor daemon if not already running. Appends free/used
    memory snapshots to metrics/vram-history.jsonl every 30s. Idempotent."""
    _monitor_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vram_monitor.py")
    if not os.path.exists(_monitor_path):
        return
    _pid_file = "/tmp/hme-vram-monitor.pid"
    try:
        with open(_pid_file) as _f:
            _pid = int(_f.read().strip())
        os.kill(_pid, 0)
        return  # live instance already running
    except (FileNotFoundError, ValueError, ProcessLookupError):  # silent-ok: no prior daemon PID on disk; proceed to spawn fresh
        pass
    import subprocess
    env = os.environ.copy()  # env-ok: subprocess needs inherited env
    env["PROJECT_ROOT"] = PROJECT_ROOT
    try:
        subprocess.Popen(
            ["python3", _monitor_path],
            env=env, start_new_session=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        logger.info("VRAM monitor started (30s polling → metrics/vram-history.jsonl)")
    except Exception as e:
        logger.warning(f"VRAM monitor start failed: {e}")


def _load_engines():
    global _project_engine, _global_engine, _shared_model_cpu, _shared_code_model_cpu, _shared_reranker_cpu, _lib_engines
    # Note: GPU instances (_shared_model / _shared_code_model / _shared_reranker)
    # are intentionally local here so VramManager offload can free their VRAM.
    # See the comment on the module-level variable declarations above.
    _shared_model = None
    _shared_code_model = None
    _shared_reranker = None
    try:
        from sentence_transformers import SentenceTransformer, CrossEncoder
        from rag_engine import RAGEngine
        from file_walker import init_config, get_lib_dirs
        from watcher import start_watcher
        init_config(PROJECT_ROOT)
        os.makedirs(PROJECT_DB, exist_ok=True)
        os.makedirs(GLOBAL_DB, exist_ok=True)

        # Device selection with VRAM reservation:
        # llama-server instances hold ~9.5 GB (arbiter, Vulkan1 = GPU0) + ~19 GB
        # (coder, Vulkan2 = GPU1) plus compute buffers. Never land a
        # sentence-transformer on a GPU that doesn't have at least _MIN_FREE_GB
        # free AFTER those are loaded. llamacpp_daemon owns that allocation
        # — see tools/HME/service/llamacpp_daemon.py for the authoritative
        # topology. Declared in .env (HME_RAG_MIN_FREE_GB).
        _MIN_FREE_GB = ENV.require_float("HME_RAG_MIN_FREE_GB")
        _rag_device = "cpu"
        # HME_RAG_GPU: "0"/"1" = fixed GPU index, "-1" = force CPU,
        # "auto" = free-memory heuristic.
        _rag_gpu_env = ENV.require("HME_RAG_GPU").strip()
        try:
            import torch
            if torch.cuda.is_available():
                if _rag_gpu_env == "-1":
                    pass  # explicit CPU
                elif _rag_gpu_env == "auto":
                    _best_gpu = -1
                    _best_free = 0
                    for _gpu_idx in range(torch.cuda.device_count()):
                        _free, _total = torch.cuda.mem_get_info(_gpu_idx)
                        _free_gb = _free / (1024 ** 3)
                        logger.info(f"GPU{_gpu_idx}: {_free_gb:.1f} GB free / {_total / (1024 ** 3):.1f} GB total")
                        if _free_gb >= _MIN_FREE_GB and _free > _best_free:
                            _best_free = _free
                            _best_gpu = _gpu_idx
                    if _best_gpu >= 0:
                        _rag_device = f"cuda:{_best_gpu}"
                    else:
                        logger.info(
                            f"No GPU has >= {_MIN_FREE_GB} GB free — RAG stack stays on CPU "
                            f"(llama-server instances own the GPUs)"
                        )
                else:
                    _gpu_idx = int(_rag_gpu_env)
                    _free, _total = torch.cuda.mem_get_info(_gpu_idx)
                    _free_gb = _free / (1024 ** 3)
                    logger.info(f"RAG target GPU{_gpu_idx}: {_free_gb:.1f} GB free / {_total / (1024 ** 3):.1f} GB total")
                    if _free_gb >= _MIN_FREE_GB:
                        _rag_device = f"cuda:{_gpu_idx}"
                    else:
                        logger.warning(
                            f"HME_RAG_GPU={_gpu_idx} has only {_free_gb:.1f} GB free "
                            f"(< {_MIN_FREE_GB}) — RAG stack falling back to CPU"
                        )
        except Exception as e:
            logger.warning(f"GPU detection failed, using CPU: {type(e).__name__}: {e}")
        logger.info(f"RAG device: {_rag_device}")

        # All three RAG models are loaded in fp16 to fit alongside arbiter
        # on GPU0. SentenceTransformer defaults to fp32 which DOUBLES VRAM
        # for no quality benefit on our inference workload. M40 Maxwell
        # emulates fp16 math in software (no speed win) but fp16 storage is
        # native — we pay ~10% throughput for ~50% VRAM savings. Worth it
        # because fp32 loads caused active-offload to churn continuously.
        import torch as _torch_fp16
        _fp16_kwargs = {"torch_dtype": _torch_fp16.float16}

        # Text embedder (Qwen3-Embedding-0.6B) — knowledge_table + symbol_table.
        # 1024-dim, Apache 2.0. Prefer ONNX backend when the export is actually
        # shipped; otherwise go straight to torch fp16 without the failed-try
        # warning that used to fire on every startup (12 times per selftest
        # window — pure noise masking real warnings).
        _onnx_path = os.path.join(MODEL_NAME, "onnx", "model.onnx") \
                     if os.path.isabs(MODEL_NAME) \
                     else None
        _has_onnx = _onnx_path and os.path.isfile(_onnx_path)
        if MODEL_BACKEND != "default" and not _has_onnx:
            logger.info(
                f"Text embedder: ONNX backend requested ({MODEL_BACKEND}) but "
                f"no onnx/model.onnx found — using torch fp16 directly"
            )
        if _has_onnx and MODEL_BACKEND != "default":
            try:
                _shared_model = SentenceTransformer(
                    MODEL_NAME, backend=MODEL_BACKEND,
                    model_kwargs={"file_name": "onnx/model.onnx"},
                )
                logger.info(f"Text embedder: {MODEL_NAME} ({MODEL_BACKEND})")
            except Exception as _onnx_err:
                logger.warning(
                    f"{MODEL_BACKEND} backend load failed ({type(_onnx_err).__name__}: "
                    f"{_onnx_err}) — falling back to torch fp16 on {_rag_device}"
                )
                _shared_model = SentenceTransformer(
                    MODEL_NAME, device=_rag_device, trust_remote_code=True,
                    model_kwargs=_fp16_kwargs,
                )
        else:
            # Direct torch fp16 load — no failed ONNX attempt, no spam warning.
            _shared_model = SentenceTransformer(
                MODEL_NAME, device=_rag_device, trust_remote_code=True,
                model_kwargs=_fp16_kwargs,
            )
            logger.info(f"Text embedder: {MODEL_NAME} (torch fp16 on {_rag_device})")

        # Code embedder (BAAI/bge-code-v1) — code_chunks table.
        # 1536-dim, Apache 2.0, Qwen2-based, 32K context. fp16 to fit in VRAM.
        # Cap max_seq_length: a single 32K-token chunk builds an attention
        # matrix that would request ~64 GiB FP16 — instant OOM. Code chunks
        # in this repo top out around 1-2K tokens (MAX_CHUNK_LINES=120),
        # so 2048 leaves headroom without exposing the killer tail.
        try:
            _shared_code_model = SentenceTransformer(
                CODE_MODEL_NAME, trust_remote_code=True, device=_rag_device,
                model_kwargs=_fp16_kwargs,
            )
            _shared_code_model.max_seq_length = 2048
            logger.info(f"Code embedder: {CODE_MODEL_NAME} on {_shared_code_model.device} (max_seq=2048)")
        except Exception as e:
            logger.warning(f"Code embedder load failed ({e}), falling back to text embedder for code_chunks")
            _shared_code_model = _shared_model

        # Listwise reranker (mxbai-rerank-base-v2) — rerank top candidates.
        # 500M params, Apache 2.0, Qwen2.5-based. fp16 to fit in VRAM.
        # MUST load via mxbai_rerank lib — CrossEncoder leaves score head
        # randomly initialized (silent corruption).
        try:
            import torch as _torch
            _shared_reranker = _MxbaiRerankerAdapter(
                RERANKER_NAME, device=_rag_device, dtype=_torch.float16,
            )
            logger.info(f"Reranker: {RERANKER_NAME} on {_rag_device}")
        except Exception as e:
            logger.warning(f"Reranker load failed ({e}) — search will fall back to RRF-only")
            _shared_reranker = None

        # CPU mirrors — loaded when RAG primary is on GPU so embedding / rerank
        # requests can fall back to CPU instances whenever the GPU is contended
        # or the model has been offloaded by the VramManager.
        _shared_model_cpu = None
        _shared_code_model_cpu = None
        _shared_reranker_cpu = None
        if _rag_device.startswith("cuda"):
            try:
                _shared_model_cpu = SentenceTransformer(
                    MODEL_NAME, device="cpu", trust_remote_code=True,
                )
                logger.info(f"Text embedder (CPU mirror): {MODEL_NAME}")
            except Exception as e:
                logger.warning(f"CPU-mirror text embedder load failed ({e}) — GPU-only fallback")
            try:
                _shared_code_model_cpu = SentenceTransformer(
                    CODE_MODEL_NAME, trust_remote_code=True, device="cpu",
                )
                logger.info(f"Code embedder (CPU mirror): {CODE_MODEL_NAME}")
            except Exception as e:
                logger.warning(f"CPU-mirror code embedder load failed ({e}) — GPU-only fallback")
            try:
                _shared_reranker_cpu = _MxbaiRerankerAdapter(RERANKER_NAME, device="cpu")
                logger.info(f"Reranker (CPU mirror): {RERANKER_NAME}")
            except Exception as e:
                logger.warning(f"CPU-mirror reranker load failed ({e}) — GPU-only fallback")

        # Reduce jina code-embedding batch size on GPU to avoid OOM spikes when
        # arbiter f16 co-resides on the shared GPU. BGE/ONNX (CPU) stays at BATCH_SIZE=64.
        _CODE_EMBED_BATCH = ENV.require_int("HME_CODE_EMBED_BATCH")
        if _rag_device.startswith("cuda"):
            os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")  # env-ok: torch runtime config

        # Wrap text / code / reranker in _RagDispatcher so concurrent requests
        # stack across GPU + CPU-mirror worker pairs and the next free worker
        # serves each queued waiter. When running on GPU, each model is
        # registered with a VramManager for active offload under pressure.
        #
        # Offload priority: SMALLEST FIRST. Under crowding, the smallest model
        # drops to CPU first (cheapest CPU fallback latency), keeping the
        # most expensive-to-run-on-CPU large model resident as long as
        # possible. Reload (after pressure clears) is reverse order: the
        # smallest comes back last, after the larger ones are already safe.
        #
        # GPU0 residents (after swap 2026-04-15):
        #   reranker: mxbai-rerank-base-v2     ~1.0 GB  priority 1 (smallest)
        #   text:     Qwen3-Embedding-0.6B     ~1.3 GB  priority 2
        #   code:     BAAI/bge-code-v1         ~4.0 GB  priority 3 (largest)
        _vram_mgr = None
        _mm_text = None
        _mm_code = None
        _mm_rerank = None
        if _rag_device.startswith("cuda"):
            from vram_manager import VramManager, ManagedModel, start_reload_poller
            _gpu_idx = int(_rag_device.split(":", 1)[1])
            _vram_mgr = VramManager(gpu_idx=_gpu_idx)

            def _make_text_gpu():
                return SentenceTransformer(
                    MODEL_NAME, device=f"cuda:{_gpu_idx}",
                    trust_remote_code=True,
                )

            def _make_code_gpu():
                return SentenceTransformer(
                    CODE_MODEL_NAME, trust_remote_code=True,
                    device=f"cuda:{_gpu_idx}",
                )

            def _make_rerank_gpu():
                import torch as _torch
                return _MxbaiRerankerAdapter(
                    RERANKER_NAME, device=f"cuda:{_gpu_idx}", dtype=_torch.float16,
                )

            # Register in smallest-first priority order (priority=1 offloads
            # first). Register order doesn't matter — VramManager.register
            # sorts by priority internally.
            if _shared_reranker is not None:
                _mm_rerank = ManagedModel(
                    name="mxbai-rerank-base-v2",
                    gpu_idx=_gpu_idx,
                    priority=1,        # smallest → first to offload
                    size_gb=1.0,
                    headroom_gb=0.5,
                    gpu_factory=_make_rerank_gpu,
                    gpu_instance=_shared_reranker,
                    cpu_instance=_shared_reranker_cpu,
                )
                _vram_mgr.register(_mm_rerank)

            # Text embedder on GPU — only register if it's actually on cuda.
            # The ONNX backend path loads to CPU and wouldn't be a managed
            # GPU instance; detect via `.device`.
            _text_is_gpu = False
            try:
                _text_is_gpu = str(getattr(_shared_model, "device", "cpu")).startswith("cuda")
            except Exception as _e:
                logger.debug(f"text-device probe failed: {type(_e).__name__}: {_e}")
            if _text_is_gpu:
                _mm_text = ManagedModel(
                    name="qwen3-embedding-0.6b-text",
                    gpu_idx=_gpu_idx,
                    priority=2,        # mid-sized
                    size_gb=1.3,
                    headroom_gb=0.5,
                    gpu_factory=_make_text_gpu,
                    gpu_instance=_shared_model,
                    cpu_instance=_shared_model_cpu,
                )
                _vram_mgr.register(_mm_text)

            _mm_code = ManagedModel(
                name="bge-code-v1",
                gpu_idx=_gpu_idx,
                priority=3,        # largest → last to offload
                size_gb=4.0,
                headroom_gb=1.5,
                gpu_factory=_make_code_gpu,
                gpu_instance=_shared_code_model,
                cpu_instance=_shared_code_model_cpu,
            )
            _vram_mgr.register(_mm_code)

            # Background poller: reload offloaded models on busy→idle edge
            # of the RAG GPU's Vulkan device.
            _rag_vulkan_tag = ENV.require("HME_RAG_VULKAN")
            start_reload_poller(
                _vram_mgr, _LLAMACPP_DAEMON_URL, _rag_vulkan_tag,
                poll_interval_s=2.0,
            )

        # Wrap text in a dispatcher only if it actually has a GPU/CPU pair
        # worth dispatching between. If ONNX CPU-only loaded it (or CPU-
        # mirror load failed with no GPU instance either), fall back to the
        # raw object so RAGEngine's .encode() path still works.
        if _mm_text is not None:
            _text_model_router = _RagDispatcher(
                _shared_model, _shared_model_cpu, "text",
                managed_model=_mm_text, vram_manager=_vram_mgr,
            )
        else:
            _text_model_router = _shared_model  # raw, unmanaged

        _code_model_router = _RagDispatcher(
            _shared_code_model, _shared_code_model_cpu, "code",
            managed_model=_mm_code, vram_manager=_vram_mgr,
        )
        _reranker_router = (
            _RagDispatcher(
                _shared_reranker, _shared_reranker_cpu, "reranker",
                managed_model=_mm_rerank, vram_manager=_vram_mgr,
            )
            if _shared_reranker is not None
            else None
        )

        _project_engine = RAGEngine(
            PROJECT_DB, model_name=MODEL_NAME,
            model=_text_model_router, code_model=_code_model_router,
            reranker=_reranker_router,
        )
        _project_engine._embed_batch_size = _CODE_EMBED_BATCH
        _global_engine = RAGEngine(
            GLOBAL_DB, model_name=MODEL_NAME,
            model=_text_model_router, code_model=_code_model_router,
            reranker=_reranker_router,
        )
        _global_engine._embed_batch_size = _CODE_EMBED_BATCH
        for _lib_rel in get_lib_dirs():
            _lib_name = _lib_rel.replace("/", "_").replace("\\", "_").strip("_")
            _lib_db = os.path.join(PROJECT_DB, "libs", _lib_name)
            os.makedirs(_lib_db, exist_ok=True)
            _eng = RAGEngine(
                db_path=_lib_db,
                model=_text_model_router, code_model=_code_model_router,
                reranker=_reranker_router,
            )
            _eng._embed_batch_size = _CODE_EMBED_BATCH
            _lib_engines[_lib_rel] = _eng
        start_watcher(PROJECT_ROOT, _project_engine)
        logger.info(f"HME HTTP: engines + file watcher ready | libs={list(_lib_engines.keys())}")
    except Exception as e:
        logger.error(f"HME HTTP: engine load failed: {e}")
    finally:
        _engine_ready.set()
        from hme_http_handlers import init_handlers
        init_handlers(_engine_ready, _project_engine, _global_engine, PROJECT_ROOT)
    # Start llama.cpp daemon after engines ready — non-blocking
    threading.Thread(target=_ensure_llamacpp_daemon, daemon=True, name="HME-llamacpp-daemon-start").start()
    # Start VRAM monitor (lightweight 30s polling) — non-blocking
    threading.Thread(target=_ensure_vram_monitor, daemon=True, name="HME-vram-monitor-start").start()


threading.Thread(target=_load_engines, daemon=True).start()


# Indexing-mode device migration
# Called by the daemon (via /reload-engines endpoint) to move embedding
# models to a freed GPU for fast indexing, then back when done.
# Stores the original device so restore knows where to put them back.
_original_rag_device: str | None = None
_reload_lock = threading.Lock()


def reload_on_device(target_device: str) -> dict:
    """Reload all GPU embedding models on `target_device`.

    HISTORICAL note (pre-R97): this function was called by the daemon's
    indexing-mode orchestration to migrate the RAG stack from cuda:0 to
    cuda:1 and back every full reindex. That migration churned CUDA
    contexts enough to trigger "illegal memory access" corruption
    regularly, which is why the user re-implemented "model pinning" ten
    times — each implementation was defeated by this function.

    R97: embedders PIN to their boot-time device (HME_RAG_GPU). The only
    legitimate caller is HME_ALLOW_EMBEDDER_MIGRATION=1 — an opt-in env
    for humans who know what they're doing. Without the opt-in, any
    migration request is refused so a regression can't silently resurrect
    the old failure mode.

    target_device: "cuda:0", "cuda:1", or "restore" to go back to original.
    """
    # Pinning enforcement. If someone explicitly sets the escape hatch,
    # allow migration — they've acknowledged the risk. Otherwise refuse.
    if os.environ.get("HME_ALLOW_EMBEDDER_MIGRATION") not in ("1", "true", "yes"):
        return {
            "error": (
                "embedder migration refused — models are pinned to HME_RAG_GPU. "
                "Set HME_ALLOW_EMBEDDER_MIGRATION=1 only if you know why the "
                "pin needs to lift; every prior migration caused CUDA corruption."
            )
        }

    # Single-writer invariant: only rag_engines may mutate embedder device
    # residency. Other callers (search, index) read-only.
    try:
        from server.lifecycle_writers import assert_writer
        assert_writer("embedders", __file__)
    except ImportError:  # silent-ok: lifecycle_writers optional outside full HME tree
        pass
    global _original_rag_device, _project_engine, _global_engine
    from sentence_transformers import SentenceTransformer

    if not _engine_ready.wait(timeout=30):
        return {"error": "engines not ready"}

    if _project_engine is None:
        return {"error": "project engine is None — engines never loaded successfully"}

    with _reload_lock:
        if target_device == "restore":
            if _original_rag_device is None:
                return {"error": "no original device saved — nothing to restore"}
            target_device = _original_rag_device
            _original_rag_device = None
            restoring = True
        else:
            # Save current device before migration
            if _original_rag_device is None:
                # Detect current device from the code model (always loaded)
                try:
                    cur = str(getattr(_project_engine.code_model, "device", "cpu"))
                except Exception:
                    cur = "cpu"
                _original_rag_device = cur
            restoring = False

        import torch as _torch
        _fp16_kwargs = {"torch_dtype": _torch.float16}
        reloaded = []
        _engines = [e for e in [_project_engine, _global_engine] + list(_lib_engines.values()) if e is not None]

        def _swap_gpu_instance(model_attr: str, new_instance):
            """Replace the GPU instance in every engine's dispatcher/managed-model.
            Collects old instances so they can be deleted to free VRAM."""
            old_instances = []
            for eng in _engines:
                target = getattr(eng, model_attr, None)
                if target is None:
                    continue
                if hasattr(target, '_mm') and target._mm is not None:
                    old = target._mm.gpu_instance
                    if old is not None and old is not new_instance:
                        old_instances.append(old)
                    target._mm.gpu_instance = new_instance
                elif hasattr(target, '_gpu'):
                    old = target._gpu
                    if old is not None and old is not new_instance:
                        old_instances.append(old)
                    target._gpu = new_instance
                else:
                    old = getattr(eng, model_attr)
                    if old is not None and old is not new_instance:
                        old_instances.append(old)
                    setattr(eng, model_attr, new_instance)
            # Break references to old GPU tensors so Python GC + CUDA can free them
            for old in old_instances:
                del old
            return len(old_instances)

        def _flush_cuda():
            """Force-free unreferenced CUDA tensors on all devices."""
            import gc
            gc.collect()
            if _torch.cuda.is_available():
                _torch.cuda.empty_cache()

        # Reload code embedder. Cap max_seq_length here too — fresh
        # SentenceTransformer instances default to the model's
        # max_position_embeddings (32K for bge-code-v1) which OOMs the
        # attention matrix for long inputs. Match the boot-time cap.
        try:
            new_code = SentenceTransformer(
                CODE_MODEL_NAME, trust_remote_code=True, device=target_device,
                model_kwargs=_fp16_kwargs,
            )
            new_code.max_seq_length = 2048
            freed = _swap_gpu_instance("code_model", new_code)
            _flush_cuda()
            reloaded.append(f"code:{CODE_MODEL_NAME}")
            logger.info(f"reload_on_device: code embedder → {target_device} (freed {freed} old refs)")
        except Exception as e:
            # CUDA illegal memory access is terminal: torch's allocator pool
            # is corrupted and every subsequent reload/encode will fail the
            # same way. Only a fresh Python process clears it. Hard-exit so
            # the proxy supervisor respawns the worker — which is what the
            # LIFESAVER message tells the user to do manually anyway
            # ("Manual remediation: restart the worker"). Self-healing.
            _err_str = str(e)
            if "illegal memory access" in _err_str or "CUDNN_STATUS_EXECUTION_FAILED" in _err_str:
                logger.error(
                    f"reload_on_device: CUDA context corrupted ({_err_str[:120]}). "
                    f"Hard-exiting worker — proxy supervisor will respawn with a fresh CUDA context. "
                    f"Indexing will continue automatically after restart."
                )
                try:
                    from server import context as _ctx
                    _ctx.register_critical_failure(
                        "cuda_context_corruption",
                        f"CUDA illegal memory access during reload_on_device({target_device}) — worker auto-restart initiated",
                        severity="CRITICAL",
                    )
                except Exception as _life_err:
                    logger.debug(f"LIFESAVER register failed pre-exit: {_life_err}")
                # Small delay so the log flushes before we die.
                import time as _t
                _t.sleep(0.2)
                os._exit(98)  # nonzero + unique so supervisor logs cleanly
            logger.error(f"reload_on_device: code embedder failed: {e}")
            return {"error": f"code embedder reload failed: {e}", "reloaded": reloaded}

        # Reload text embedder
        try:
            new_text = SentenceTransformer(
                MODEL_NAME, device=target_device, trust_remote_code=True,
                model_kwargs=_fp16_kwargs,
            )
            freed = _swap_gpu_instance("text_model", new_text)
            _flush_cuda()
            reloaded.append(f"text:{MODEL_NAME}")
            logger.info(f"reload_on_device: text embedder → {target_device} (freed {freed} old refs)")
        except Exception as e:
            logger.warning(f"reload_on_device: text embedder failed: {e}")
            # Non-fatal — code embedder is the primary indexing model

        # Reload reranker
        try:
            new_reranker = _MxbaiRerankerAdapter(
                RERANKER_NAME, device=target_device, dtype=_torch.float16,
            )
            freed = _swap_gpu_instance("reranker", new_reranker)
            _flush_cuda()
            reloaded.append(f"reranker:{RERANKER_NAME}")
            logger.info(f"reload_on_device: reranker → {target_device} (freed {freed} old refs)")
        except Exception as e:
            logger.warning(f"reload_on_device: reranker failed: {e}")
            # Non-fatal — indexing doesn't use reranker

        # On restore, the GPU we just vacated still holds our CUDA context
        # (~150 MB). That's enough to push coder's spawn fit-check past its
        # margin. Empty caches on every CUDA device so the freed VRAM is
        # actually visible to nvidia-smi (which the daemon uses for fits).
        if restoring and _torch.cuda.is_available():
            for _dev_idx in range(_torch.cuda.device_count()):
                try:
                    with _torch.cuda.device(_dev_idx):
                        _torch.cuda.empty_cache()
                        _torch.cuda.ipc_collect()
                except Exception as _cc_err:
                    logger.debug(f"reload_on_device: cuda:{_dev_idx} empty_cache failed: {_cc_err}")

        return {
            "device": target_device,
            "reloaded": reloaded,
            "restoring": restoring,
        }
