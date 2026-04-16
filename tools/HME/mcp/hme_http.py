"""HME HTTP shim — persistent RAG authority and enrichment server.

The MCP server delegates all RAG operations here via /rag dispatch,
eliminating duplicate SentenceTransformer loading on every MCP restart.
The shim is long-lived (managed by ChatPanel or auto-started by MCP server).

Endpoints:
  POST /rag          — generic RAG dispatch (MCP server proxy calls)
  POST /enrich       — KB + transcript context for message enrichment
  POST /validate     — pre-send anti-pattern/constraint check
  POST /audit        — post-response changed-file constraint audit
  POST /reindex      — immediate mini-reindex of specific files
  GET  /transcript   — read recent session transcript entries (JSONL)
  POST /transcript   — append entries to session transcript
  GET  /health       — readiness check
  GET  /narrative    — latest narrative digest from transcript

Usage:
  PROJECT_ROOT=/path/to/project python hme_http.py [--port 7734] [--daemon]
"""
import os
import sys
import json
import time
import logging
import argparse
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

_tool_root = os.path.dirname(os.path.abspath(__file__))
if _tool_root not in sys.path:
    sys.path.insert(0, _tool_root)

# Central .env loader — fail-fast semantics.
from hme_env import ENV  # noqa: E402

logging.basicConfig(level=logging.WARNING, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("HME.http")
logger.setLevel(logging.INFO)

PROJECT_ROOT = ENV.require("PROJECT_ROOT")
PROJECT_DB = ENV.require("RAG_DB_PATH")
GLOBAL_DB = os.path.join(os.path.expanduser("~"), ".claude", "mcp", "HME", "global_kb")
MODEL_NAME = ENV.require("RAG_MODEL")
MODEL_BACKEND = ENV.require("RAG_BACKEND")

_engine_ready = threading.Event()
_project_engine = None
_global_engine = None
# NOTE: GPU instances are intentionally NOT held at module scope. They're
# owned by ManagedModel.gpu_instance and nowhere else, so VramManager's
# offload (which nulls ManagedModel.gpu_instance and calls
# torch.cuda.empty_cache) can actually release the VRAM. Holding a
# secondary _shared_model reference here would pin the torch module
# permanently and silently defeat offload. The `_RagDispatcher` reads the
# current GPU instance via `_current_gpu()` → `managed_model.gpu_instance`.
# CPU mirrors stay at module scope — they don't pressure VRAM.
_shared_model_cpu = None       # Qwen3-Embedding-0.6B — CPU mirror
_shared_code_model_cpu = None  # bge-code-v1 — CPU mirror
_shared_reranker_cpu = None    # mxbai-rerank-base-v2 — CPU mirror


# ── RAG routing: GPU vs CPU mirror ────────────────────────────────────────
# When the arbiter is actively processing a request on the shared GPU, we
# route jina / bge-reranker work to the CPU mirrors to avoid contending for
# compute. The llamacpp_daemon exposes /rag-route which answers "gpu" or
# "cpu" based on its in-memory _arbiter_busy flag (set around every arbiter
# request dispatch). We cache the last answer for 100 ms so bursty RAG calls
# don't DoS the daemon with HTTP probes.
_LLAMACPP_DAEMON_URL = ENV.require("HME_LLAMACPP_DAEMON_URL")
_rag_route_cache = {"route": "gpu", "ts": 0.0}
_rag_route_ttl_s = 0.1


def _rag_route() -> str:
    """Return 'gpu' or 'cpu' for the next RAG op on the RAG GPU.

    Queries the daemon's per-device /rag-route?device=<RAG's Vulkan tag>.
    Falls back to 'gpu' if the daemon is unreachable or no CPU mirror exists.
    Cache-gated to ~100ms so a single tool call's batch of encode/rerank calls
    doesn't spam the daemon.
    """
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
    except Exception as _e:
        logger.debug(f"_rag_route: daemon unreachable ({type(_e).__name__}), defaulting to gpu")
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

    def _current_gpu(self):
        """Resolve the GPU instance at call time. With a managed model, the
        source is ManagedModel.gpu_instance (may flip to None when offloaded).
        Without, it's the static pointer given at construction."""
        if self._mm is not None:
            return self._mm.gpu_instance
        return self._gpu

    def _acquire(self):
        """Return (instance, release_fn). Blocks until a worker is free."""
        # Fast paths for degraded modes (one-sided). Re-check on every call
        # since a managed model can flip between resident / offloaded.
        cpu = self._cpu
        gpu_at_start = self._current_gpu()
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
                if gpu_ok and self._gpu_sem is not None and self._gpu_sem.acquire(blocking=False):
                    # Pressure check: ensure headroom before committing to GPU.
                    if self._vram is not None and self._mm is not None:
                        ok = self._vram.request_room(self._mm.headroom_gb, caller=self._mm)
                        if not ok:
                            # Couldn't free enough; release the GPU slot and try CPU.
                            self._gpu_sem.release()
                            self._cv.notify_all()
                        else:
                            return gpu, self._release_gpu
                    else:
                        return gpu, self._release_gpu
                # Fall back to CPU if available
                if self._cpu_sem is not None and self._cpu_sem.acquire(blocking=False):
                    return cpu, self._release_cpu
                # Both slots unavailable — wait for a release (re-poll at 1s)
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


CODE_MODEL_NAME = ENV.require("RAG_CODE_MODEL")
RERANKER_NAME = ENV.require("RAG_RERANKER_MODEL")

# Initialise stores with paths before any request can arrive
from hme_http_store import init_store
init_store(PROJECT_ROOT)


def _ensure_llamacpp_daemon():
    """Start the llama.cpp persistence daemon if not already running.

    Owns llamacpp_supervisor (spawns/adopts llama-server instances for arbiter
    and coder), the arbiter-busy flag that drives RAG CPU/GPU routing, and the
    generation proxy for legacy callers.
    """
    import urllib.request as _urlreq
    _daemon_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "llamacpp_daemon.py")
    if not os.path.exists(_daemon_path):
        return
    try:
        with _urlreq.urlopen(_urlreq.Request("http://127.0.0.1:7735/health"), timeout=1) as _r:
            if _r.status == 200:
                return  # already running
    except Exception as _e:
        logger.debug(f"_ensure_llamacpp_daemon: daemon probe failed ({type(_e).__name__}), will spawn")
    import subprocess
    env = os.environ.copy()
    env["PROJECT_ROOT"] = PROJECT_ROOT
    try:
        subprocess.Popen(
            ["python3", _daemon_path],
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
    except (FileNotFoundError, ValueError, ProcessLookupError):
        pass
    import subprocess
    env = os.environ.copy()
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
        # free AFTER those are loaded. The llamacpp_supervisor owns that
        # allocation — see server/llamacpp_supervisor.py for the authoritative
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
        # 1024-dim, Apache 2.0. Tries ONNX backend first; falls through to
        # torch fp16 on GPU when no ONNX export is shipped.
        try:
            _shared_model = SentenceTransformer(
                MODEL_NAME, backend=MODEL_BACKEND,
                model_kwargs={"file_name": "onnx/model.onnx"},
            )
            logger.info(f"Text embedder: {MODEL_NAME} ({MODEL_BACKEND})")
        except Exception as e:
            logger.warning(
                f"{MODEL_BACKEND} backend failed ({type(e).__name__}), "
                f"falling back to torch fp16 on {_rag_device}"
            )
            _shared_model = SentenceTransformer(
                MODEL_NAME, device=_rag_device, trust_remote_code=True,
                model_kwargs=_fp16_kwargs,
            )

        # Code embedder (BAAI/bge-code-v1) — code_chunks table.
        # 1536-dim, Apache 2.0, Qwen2-based, 32K context. fp16 to fit in VRAM.
        try:
            _shared_code_model = SentenceTransformer(
                CODE_MODEL_NAME, trust_remote_code=True, device=_rag_device,
                model_kwargs=_fp16_kwargs,
            )
            logger.info(f"Code embedder: {CODE_MODEL_NAME} on {_shared_code_model.device}")
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
            os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

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


class _ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        logger.info(fmt % args)

    def _send_json(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _handle_rag_dispatch(self, body: dict):
        """Generic dispatch: MCP server proxy calls any engine method via HTTP."""
        engine_name = body.get("engine", "project")
        method = body.get("method", "")
        kwargs = body.get("kwargs", {})
        # Layer 1: log session ID for cross-component correlation
        session_id = self.headers.get("X-HME-Session", "")
        if session_id:
            logger.debug(f"/rag session={session_id} {engine_name}.{method}")

        if not _engine_ready.wait(timeout=10):
            self._send_json(503, {"error": "engines loading"})
            return

        if engine_name == "project":
            engine = _project_engine
        elif engine_name == "global":
            engine = _global_engine
        elif engine_name.startswith("lib/"):
            engine = _lib_engines.get(engine_name[4:])
        else:
            engine = None
        if engine is None:
            self._send_json(503, {"error": f"{engine_name} engine not ready"})
            return

        try:
            if method == "_symbol_table_list":
                result = engine.symbol_table.to_arrow().to_pylist() if engine.symbol_table is not None else []
            elif method == "_encode":
                # Route through the engine's model (which is the dispatcher
                # when the text embedder is VramManager-managed) so this
                # debug path respects pressure / offload / CPU fallback.
                # Never use _shared_model directly — see invariant
                # "no-direct-shared-model-encode" in workflow_audit.py.
                texts = kwargs.get("texts", [])
                result = engine.text_model.encode(texts).tolist() if engine.text_model is not None else []
            elif method == "_get_file_hashes":
                result = dict(getattr(engine, "_file_hashes", {}))
            elif method == "index_directory":
                # Lock index_directory to PROJECT_ROOT — never allow directory override
                result = getattr(engine, method)(directory=PROJECT_ROOT)
            elif hasattr(engine, method) and callable(getattr(engine, method)):
                result = getattr(engine, method)(**kwargs)
            else:
                self._send_json(400, {"error": f"unknown method: {method}"})
                return
            self._send_json(200, {"result": result})
        except Exception as e:
            logger.error(f"/rag dispatch {engine_name}.{method}: {type(e).__name__}: {e}")
            self._send_json(500, {"error": str(e)})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        from hme_http_store import _get_recent_errors, _get_transcript, _transcript_entries
        from hme_http_store import _latest_narrative
        if self.path == "/health":
            ready = _engine_ready.is_set() and _project_engine is not None
            recent_errors = _get_recent_errors(minutes=120)
            _training_lock = ENV.require("HME_TRAINING_LOCK")
            _training_locked = os.path.exists(_training_lock)
            # During training, report as ready+healthy so the proxy monitor doesn't
            # restart-loop the shim. Training lock intentionally blocks engine init.
            # `training_locked: true` signals to callers that RAG is unavailable.
            _effective_ready = ready or _training_locked
            self._send_json(200, {
                "status": "ready" if _effective_ready else "loading",
                "transcript_entries": len(_transcript_entries),
                "kb_ready": _project_engine is not None or _training_locked,
                "training_locked": _training_locked,
                "recent_errors": recent_errors[-10:],
                "error_count": len(recent_errors),
                "pid": os.getpid(),  # Layer 1: shim identity for cross-component correlation
                "endpoints": [
                    "/rag", "/enrich", "/enrich_prompt", "/validate", "/audit",
                    "/reindex", "/transcript", "/health", "/narrative",
                    "/rag/lib-list", "/capabilities",
                ],
            })
        elif self.path.startswith("/transcript"):
            # Parse ?minutes=N&max=M from query string
            import urllib.parse
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            minutes = int(params.get("minutes", [30])[0])
            max_entries = int(params.get("max", [50])[0])
            entries = _get_transcript(minutes, max_entries)
            self._send_json(200, {"entries": entries, "count": len(entries)})
        elif self.path == "/narrative":
            self._send_json(200, {"narrative": _latest_narrative})
        elif self.path == "/rag/lib-list":
            self._send_json(200, {"keys": list(_lib_engines.keys())})
        elif self.path == "/capabilities":
            self._send_json(200, {
                "endpoints": [
                    "/rag", "/enrich", "/enrich_prompt", "/validate", "/audit",
                    "/reindex", "/transcript", "/health", "/narrative",
                    "/rag/lib-list", "/capabilities",
                ],
                "rag_ready": _engine_ready.is_set() and _project_engine is not None,
            })
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except Exception as e:
            self._send_json(400, {"error": f"bad request: {e}"})
            return

        from hme_http_handlers import _enrich, _enrich_prompt, _validate, _post_audit, _reindex_files
        from hme_http_store import _append_transcript, _log_error
        import hme_http_store as _store

        if self.path == "/enrich":
            query = body.get("query", "")
            top_k = int(body.get("top_k", 5))
            if not query:
                self._send_json(400, {"error": "query required"})
                return
            self._send_json(200, _enrich(query, top_k=top_k))

        elif self.path == "/enrich_prompt":
            prompt = body.get("prompt", "")
            frame = body.get("frame", "")
            if not prompt:
                self._send_json(400, {"error": "prompt required"})
                return
            try:
                self._send_json(200, _enrich_prompt(prompt, frame))
            except Exception as e:
                logger.error(f"/enrich_prompt unhandled: {e}")
                self._send_json(200, {"enriched": prompt, "original": prompt, "error": str(e)})

        elif self.path == "/validate":
            query = body.get("query", "")
            if not query:
                self._send_json(400, {"error": "query required"})
                return
            self._send_json(200, _validate(query))

        elif self.path == "/audit":
            changed_files = body.get("changed_files", "")
            self._send_json(200, _post_audit(changed_files))

        elif self.path == "/transcript":
            entries = body.get("entries", [])
            if not isinstance(entries, list):
                self._send_json(400, {"error": "entries must be a list"})
                return
            count = _append_transcript(entries)
            self._send_json(200, {"appended": count})

        elif self.path == "/reindex":
            files = body.get("files", [])
            if not isinstance(files, list) or not files:
                self._send_json(400, {"error": "files must be a non-empty list"})
                return
            result = _reindex_files(files)
            self._send_json(200, result)

        elif self.path == "/rag":
            self._handle_rag_dispatch(body)

        elif self.path == "/error":
            source = body.get("source", "unknown")
            message = body.get("message", "")
            detail = body.get("detail", "")
            if not message:
                self._send_json(400, {"error": "message required"})
                return
            _log_error(source, message, detail)
            self._send_json(200, {"logged": True})

        elif self.path == "/narrative":
            # Store a narrative digest
            _store._latest_narrative = body.get("narrative", "")
            _append_transcript([{
                "type": "narrative",
                "content": _store._latest_narrative,
                "summary": f"[Digest] {_store._latest_narrative[:100]}",
            }])
            self._send_json(200, {"ok": True})

        else:
            self._send_json(404, {"error": "not found"})


_PID_FILE = "/tmp/hme-http-shim.pid"


def main():
    import errno as _errno
    parser = argparse.ArgumentParser(description="HME HTTP enrichment shim")
    parser.add_argument("--port", type=int, default=7734)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--daemon", action="store_true", help="Write PID file for lifecycle management")
    args = parser.parse_args()

    # Always write PID file — both ChatPanel-managed and MCP-spawned instances need coordination.
    with open(_PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    try:
        server = _ThreadingHTTPServer((args.host, args.port), _Handler)
    except OSError as _e:
        if _e.errno == _errno.EADDRINUSE:
            # Port taken — check if our PID file points to a live process
            try:
                _existing_pid = int(open(_PID_FILE).read().strip())
                os.kill(_existing_pid, 0)  # raises if process is dead
                logger.warning(
                    f"Port {args.port} already in use by pid={_existing_pid} — not starting duplicate shim"
                )
                sys.exit(0)
            except (ProcessLookupError, ValueError, OSError):
                pass  # stale PID file or dead process — proceed with error
        raise

    logger.info(f"HME HTTP shim listening on {args.host}:{args.port} (pid={os.getpid()})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        # Always clean up PID file — only remove if it still points to us
        try:
            if os.path.exists(_PID_FILE):
                with open(_PID_FILE) as _f:
                    if _f.read().strip() == str(os.getpid()):
                        os.unlink(_PID_FILE)
        except OSError:
            pass


if __name__ == "__main__":
    main()
