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

PROJECT_ROOT = os.environ.get("PROJECT_ROOT") or os.getcwd()
PROJECT_DB = os.environ.get("RAG_DB_PATH") or os.path.join(PROJECT_ROOT, ".claude", "mcp", "HME")
GLOBAL_DB = os.path.join(os.path.expanduser("~"), ".claude", "mcp", "HME", "global_kb")
MODEL_NAME = os.environ.get("RAG_MODEL", "BAAI/bge-base-en-v1.5")
MODEL_BACKEND = os.environ.get("RAG_BACKEND", "onnx")

_engine_ready = threading.Event()
_project_engine = None
_global_engine = None
_shared_model = None           # bge-base-en-v1.5 — text/knowledge/symbols embedder (ONNX/CPU)
_shared_code_model = None      # jina-embeddings-v2-base-code — code_chunks embedder (GPU primary)
_shared_reranker = None        # bge-reranker-v2-m3 — cross-encoder for rerank (GPU primary)
_shared_code_model_cpu = None  # jina — CPU mirror, used when arbiter is busy on shared GPU
_shared_reranker_cpu = None    # bge-reranker — CPU mirror, used when arbiter is busy on shared GPU


# ── RAG routing: GPU vs CPU mirror ────────────────────────────────────────
# When the arbiter is actively processing a request on the shared GPU, we
# route jina / bge-reranker work to the CPU mirrors to avoid contending for
# compute. The llamacpp_daemon exposes /rag-route which answers "gpu" or
# "cpu" based on its in-memory _arbiter_busy flag (set around every arbiter
# request dispatch). We cache the last answer for 100 ms so bursty RAG calls
# don't DoS the daemon with HTTP probes.
_LLAMACPP_DAEMON_URL = os.environ.get(
    "HME_LLAMACPP_DAEMON_URL", "http://127.0.0.1:7735"
)
_rag_route_cache = {"route": "gpu", "ts": 0.0}
_rag_route_ttl_s = 0.1


def _rag_route() -> str:
    """Return 'gpu' or 'cpu' for the next RAG op.

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
        with _ur.urlopen(f"{_LLAMACPP_DAEMON_URL}/rag-route", timeout=0.2) as resp:
            data = json.loads(resp.read())
            route = data.get("route", "gpu")
    except Exception:
        route = "gpu"
    _rag_route_cache["route"] = route
    _rag_route_cache["ts"] = now
    return route


class _RagDispatcher:
    """Queue-aware dispatcher over a (GPU, CPU) worker pair.

    Replaces the old _RagRouterProxy. Acquire semantics:
      1. Prefer GPU when the daemon reports the RAG GPU is idle AND the GPU
         worker's slot is free.
      2. Fall back to the CPU mirror when the GPU is contended OR its slot
         is held by another in-flight RAG call.
      3. When both slots are held, the caller blocks on a condition variable
         and is woken by the next release. Re-polls the daemon flag every
         second in case arbiter finished mid-wait.

    Both workers get a semaphore with one slot. When multiple concurrent
    encode/predict calls arrive, they stack across the two workers (first
    takes GPU, second takes CPU) and additional callers queue on the CV.
    The first free compatible worker wins the next waiter.

    If only one worker exists (CPU load failed, or GPU-only mode), the
    dispatcher degrades to that single worker with straightforward blocking
    acquire. Full interface compatibility with SentenceTransformer /
    CrossEncoder — .encode, .predict, .device, and arbitrary attribute
    delegation via __getattr__.
    """

    def __init__(self, gpu_instance, cpu_instance, label: str):
        self._gpu = gpu_instance
        self._cpu = cpu_instance
        self._label = label
        self._gpu_sem = threading.Semaphore(1) if gpu_instance is not None else None
        self._cpu_sem = threading.Semaphore(1) if cpu_instance is not None else None
        self._cv = threading.Condition()

    def _acquire(self):
        """Return (instance, release_fn). Blocks until a worker is free."""
        # Fast paths for degraded modes
        if self._gpu is None and self._cpu is not None:
            self._cpu_sem.acquire()
            return self._cpu, self._release_cpu
        if self._cpu is None and self._gpu is not None:
            self._gpu_sem.acquire()
            return self._gpu, self._release_gpu

        with self._cv:
            while True:
                # 1. Prefer GPU if daemon says GPU is free and slot is open
                if _rag_route() == "gpu" and self._gpu_sem.acquire(blocking=False):
                    return self._gpu, self._release_gpu
                # 2. Fall back to CPU if slot is open
                if self._cpu_sem.acquire(blocking=False):
                    return self._cpu, self._release_cpu
                # 3. Both slots held — wait for a release (re-poll daemon at 1s)
                self._cv.wait(timeout=1.0)

    def _release_gpu(self):
        with self._cv:
            self._gpu_sem.release()
            self._cv.notify_all()

    def _release_cpu(self):
        with self._cv:
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
        inst = self._gpu if self._gpu is not None else self._cpu
        return getattr(inst, "device", "unknown")

    def __getattr__(self, name):
        # Delegate non-dispatch attributes (tokenizer, max_seq_length, etc.)
        # to whichever instance exists, preferring GPU for config consistency.
        inst = self.__dict__.get("_gpu") or self.__dict__.get("_cpu")
        if inst is None:
            raise AttributeError(name)
        return getattr(inst, name)
_lib_engines: dict = {}  # key = lib_rel path

CODE_MODEL_NAME = os.environ.get("RAG_CODE_MODEL", "jinaai/jina-embeddings-v2-base-code")
RERANKER_NAME = os.environ.get("RAG_RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")

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
    except Exception:
        pass
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
    global _project_engine, _global_engine, _shared_model, _shared_code_model, _shared_reranker, _shared_code_model_cpu, _shared_reranker_cpu, _lib_engines
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

        # Text embedder (bge-base-en-v1.5) — knowledge_table + symbol_table
        # ONNX backend is CPU-only and small (~400MB RAM) — intentionally NOT on GPU.
        try:
            _shared_model = SentenceTransformer(MODEL_NAME, backend=MODEL_BACKEND, model_kwargs={"file_name": "onnx/model.onnx"})
            logger.info(f"Text embedder: {MODEL_NAME} ({MODEL_BACKEND})")
        except Exception as e:
            logger.warning(f"{MODEL_BACKEND} backend failed ({e}), falling back to torch on {_rag_device}")
            _shared_model = SentenceTransformer(MODEL_NAME, device=_rag_device)

        # Code embedder (jina-embeddings-v2-base-code) — code_chunks table
        # Placed on GPU1 (or CPU fallback). trust_remote_code required for JinaBERT.
        try:
            _shared_code_model = SentenceTransformer(
                CODE_MODEL_NAME, trust_remote_code=True, device=_rag_device,
            )
            logger.info(f"Code embedder: {CODE_MODEL_NAME} on {_shared_code_model.device}")
        except Exception as e:
            logger.warning(f"Code embedder load failed ({e}), falling back to text embedder for code_chunks")
            _shared_code_model = _shared_model

        # Cross-encoder reranker (bge-reranker-v2-m3) — rerank top candidates
        try:
            _shared_reranker = CrossEncoder(RERANKER_NAME, max_length=512, device=_rag_device)
            logger.info(f"Reranker: {RERANKER_NAME} on {_rag_device}")
        except Exception as e:
            logger.warning(f"Reranker load failed ({e}) — search will fall back to RRF-only")
            _shared_reranker = None

        # CPU mirrors — loaded when RAG primary is on GPU so embedding / rerank
        # requests can fall back to CPU instances whenever the arbiter is busy
        # on the shared GPU. Daemon's /rag-route endpoint owns the decision.
        _shared_code_model_cpu = None
        _shared_reranker_cpu = None
        if _rag_device.startswith("cuda"):
            try:
                _shared_code_model_cpu = SentenceTransformer(
                    CODE_MODEL_NAME, trust_remote_code=True, device="cpu",
                )
                logger.info(f"Code embedder (CPU mirror): {CODE_MODEL_NAME}")
            except Exception as e:
                logger.warning(f"CPU-mirror code embedder load failed ({e}) — GPU-only fallback")
            try:
                _shared_reranker_cpu = CrossEncoder(RERANKER_NAME, max_length=512, device="cpu")
                logger.info(f"Reranker (CPU mirror): {RERANKER_NAME}")
            except Exception as e:
                logger.warning(f"CPU-mirror reranker load failed ({e}) — GPU-only fallback")

        # Reduce jina code-embedding batch size on GPU to avoid OOM spikes when
        # arbiter f16 co-resides on the shared GPU. BGE/ONNX (CPU) stays at BATCH_SIZE=64.
        _CODE_EMBED_BATCH = ENV.require_int("HME_CODE_EMBED_BATCH")
        if _rag_device.startswith("cuda"):
            os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

        # Wrap code_model + reranker in _RagDispatcher so concurrent requests
        # stack across the GPU + CPU-mirror worker pair and the next free
        # compatible worker serves each queued waiter. The text_model (bge
        # ONNX) is CPU-only and stays unwrapped.
        _code_model_router = _RagDispatcher(_shared_code_model, _shared_code_model_cpu, "code")
        _reranker_router = _RagDispatcher(_shared_reranker, _shared_reranker_cpu, "reranker") if _shared_reranker is not None else None

        _project_engine = RAGEngine(
            PROJECT_DB, model_name=MODEL_NAME,
            model=_shared_model, code_model=_code_model_router, reranker=_reranker_router,
        )
        _project_engine._embed_batch_size = _CODE_EMBED_BATCH
        _global_engine = RAGEngine(
            GLOBAL_DB, model_name=MODEL_NAME,
            model=_shared_model, code_model=_code_model_router, reranker=_reranker_router,
        )
        _global_engine._embed_batch_size = _CODE_EMBED_BATCH
        for _lib_rel in get_lib_dirs():
            _lib_name = _lib_rel.replace("/", "_").replace("\\", "_").strip("_")
            _lib_db = os.path.join(PROJECT_DB, "libs", _lib_name)
            os.makedirs(_lib_db, exist_ok=True)
            _eng = RAGEngine(
                db_path=_lib_db,
                model=_shared_model, code_model=_code_model_router, reranker=_reranker_router,
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
                texts = kwargs.get("texts", [])
                result = _shared_model.encode(texts).tolist() if _shared_model else []
            elif method == "_get_file_hashes":
                result = dict(getattr(engine, "_file_hashes", {}))
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
