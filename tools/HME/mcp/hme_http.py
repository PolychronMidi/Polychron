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
import logging
import argparse
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

_tool_root = os.path.dirname(os.path.abspath(__file__))
if _tool_root not in sys.path:
    sys.path.insert(0, _tool_root)

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
_shared_model = None
_lib_engines: dict = {}  # key = lib_rel path

# Initialise stores with paths before any request can arrive
from hme_http_store import init_store
init_store(PROJECT_ROOT)


def _ensure_ollama_daemon():
    """Start the Ollama persistence daemon if not already running."""
    import urllib.request as _urlreq
    _daemon_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ollama_daemon.py")
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
        logger.info("Ollama daemon started (port 7735)")
    except Exception as e:
        logger.warning(f"Ollama daemon start failed: {e}")


def _load_engines():
    global _project_engine, _global_engine, _shared_model, _lib_engines
    try:
        from sentence_transformers import SentenceTransformer
        from rag_engine import RAGEngine
        from file_walker import init_config, get_lib_dirs
        from watcher import start_watcher
        init_config(PROJECT_ROOT)
        os.makedirs(PROJECT_DB, exist_ok=True)
        os.makedirs(GLOBAL_DB, exist_ok=True)
        try:
            _shared_model = SentenceTransformer(MODEL_NAME, backend=MODEL_BACKEND, model_kwargs={"file_name": "onnx/model.onnx"})
            logger.info(f"Loaded {MODEL_NAME} with {MODEL_BACKEND} backend")
        except Exception as e:
            logger.warning(f"{MODEL_BACKEND} backend failed ({e}), falling back to torch")
            _shared_model = SentenceTransformer(MODEL_NAME)
        _project_engine = RAGEngine(PROJECT_DB, model_name=MODEL_NAME, model=_shared_model)
        _global_engine = RAGEngine(GLOBAL_DB, model_name=MODEL_NAME, model=_shared_model)
        for _lib_rel in get_lib_dirs():
            _lib_name = _lib_rel.replace("/", "_").replace("\\", "_").strip("_")
            _lib_db = os.path.join(PROJECT_DB, "libs", _lib_name)
            os.makedirs(_lib_db, exist_ok=True)
            _lib_engines[_lib_rel] = RAGEngine(db_path=_lib_db, model=_shared_model)
        start_watcher(PROJECT_ROOT, _project_engine)
        logger.info(f"HME HTTP: engines + file watcher ready | libs={list(_lib_engines.keys())}")
    except Exception as e:
        logger.error(f"HME HTTP: engine load failed: {e}")
    finally:
        _engine_ready.set()
        from hme_http_handlers import init_handlers
        init_handlers(_engine_ready, _project_engine, _global_engine, PROJECT_ROOT)
    # Start Ollama daemon after engines ready — non-blocking
    threading.Thread(target=_ensure_ollama_daemon, daemon=True, name="HME-ollama-daemon-start").start()


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
            self._send_json(200, {
                "status": "ready" if ready else "loading",
                "transcript_entries": len(_transcript_entries),
                "kb_ready": _project_engine is not None,
                "recent_errors": recent_errors[-10:],
                "error_count": len(recent_errors),
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
