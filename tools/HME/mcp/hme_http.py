"""HME HTTP shim — full enrichment server for the HME chat ecosystem.

Endpoints:
  POST /enrich       — KB + transcript context for message enrichment
  POST /validate     — pre-send anti-pattern/constraint check
  POST /audit        — post-response changed-file constraint audit
  POST /reindex      — immediate mini-reindex of specific files
  GET  /transcript   — read recent session transcript entries (JSONL)
  POST /transcript   — append entries to session transcript
  GET  /health       — readiness check
  GET  /narrative    — latest narrative digest from transcript

Usage:
  PROJECT_ROOT=/path/to/project python hme_http.py [--port 7734]
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

# Initialise stores with paths before any request can arrive
from hme_http_store import init_store
init_store(PROJECT_ROOT)


def _load_engines():
    global _project_engine, _global_engine
    try:
        from sentence_transformers import SentenceTransformer
        from rag_engine import RAGEngine
        from file_walker import init_config
        init_config(PROJECT_ROOT)
        os.makedirs(PROJECT_DB, exist_ok=True)
        os.makedirs(GLOBAL_DB, exist_ok=True)
        # Load model once, share across engines (same as MCP main.py)
        try:
            shared_model = SentenceTransformer(MODEL_NAME, backend=MODEL_BACKEND, model_kwargs={"file_name": "onnx/model.onnx"})
            logger.info(f"Loaded {MODEL_NAME} with {MODEL_BACKEND} backend")
        except Exception as e:
            logger.warning(f"{MODEL_BACKEND} backend failed ({e}), falling back to torch")
            shared_model = SentenceTransformer(MODEL_NAME)
        _project_engine = RAGEngine(PROJECT_DB, model_name=MODEL_NAME, model=shared_model)
        _global_engine = RAGEngine(GLOBAL_DB, model_name=MODEL_NAME, model=shared_model)
        logger.info("HME HTTP: engines ready")
    except Exception as e:
        logger.error(f"HME HTTP: engine load failed: {e}")
    finally:
        _engine_ready.set()
        from hme_http_handlers import init_handlers
        init_handlers(_engine_ready, _project_engine, _global_engine, PROJECT_ROOT)


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
            self._send_json(200, _enrich_prompt(prompt, frame))

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

        elif self.path == "/error":
            # Critical error from chat panel — log it visibly for main session inspection
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


def main():
    parser = argparse.ArgumentParser(description="HME HTTP enrichment shim")
    parser.add_argument("--port", type=int, default=7734)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    server = _ThreadingHTTPServer((args.host, args.port), _Handler)
    logger.info(f"HME HTTP shim listening on {args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
