"""Ollama persistence daemon — keeps models loaded across MCP server restarts.

Runs on port 7735, writes PID to /tmp/hme-ollama-daemon.pid.
The MCP server checks this daemon before running _init_ollama_models().
If the daemon confirms models are loaded, the MCP server skips init entirely.

Usage:
    python3 ollama_daemon.py [--port 7735]
"""
import json
import logging
import os
import signal
import sys
import threading
import time
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

logging.basicConfig(level=logging.WARNING, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("HME.ollama")
logger.setLevel(logging.INFO)

PID_FILE = "/tmp/hme-ollama-daemon.pid"

_PORT_GPU0 = int(os.environ.get("HME_OLLAMA_PORT_GPU0", "11434"))
_PORT_GPU1 = int(os.environ.get("HME_OLLAMA_PORT_GPU1", "11435"))
_PORT_CPU = int(os.environ.get("HME_OLLAMA_PORT_CPU", "11436"))

_LOCAL_MODEL = os.environ.get("HME_LOCAL_MODEL", "hf.co/bartowski/Qwen3-30B-A3B-GGUF:Q4_K_XL")
_REASONING_MODEL = os.environ.get("HME_REASONING_MODEL", "qwen3:30b-a3b")
_ARBITER_MODEL = os.environ.get("HME_ARBITER_MODEL", "qwen3:4b")

_KEEP_ALIVE = int(os.environ.get("HME_KEEP_ALIVE", "-1"))
_NUM_CTX_30B = int(os.environ.get("HME_NUM_CTX_30B", "32768"))
_NUM_CTX_4B = int(os.environ.get("HME_NUM_CTX_4B", "8192"))

_MODELS = [
    (_LOCAL_MODEL, _PORT_GPU0, {"num_predict": 1, "num_ctx": _NUM_CTX_30B}),
    (_REASONING_MODEL, _PORT_GPU1, {"num_predict": 1, "num_ctx": _NUM_CTX_30B}),
    (_ARBITER_MODEL, _PORT_CPU, {"num_predict": 1, "num_ctx": _NUM_CTX_4B}),
]

_model_status: dict = {}
_status_lock = threading.Lock()
_HEALTH_INTERVAL = 300


def _ollama_url(port):
    return f"http://localhost:{port}/api/generate"


def _load_model(model, port, options):
    url = _ollama_url(port)
    payload = json.dumps({
        "model": model, "prompt": "", "stream": False,
        "keep_alive": _KEEP_ALIVE, "options": options,
    }).encode()
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            resp.read()
        elapsed = time.time() - t0
        with _status_lock:
            _model_status[model] = {"loaded": True, "port": port, "elapsed": round(elapsed, 1), "ts": time.time()}
        logger.info(f"Model loaded: {model} on port {port} ({elapsed:.1f}s)")
        return True
    except Exception as e:
        with _status_lock:
            _model_status[model] = {"loaded": False, "port": port, "error": str(e), "ts": time.time()}
        logger.error(f"Model load failed: {model} on port {port}: {e}")
        return False


def _check_model(model, port):
    url = f"http://localhost:{port}/api/ps"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read())
        for m in data.get("models", []):
            if model in m.get("name", ""):
                return True
    except Exception:
        pass
    return False


def _ensure_all_loaded():
    results = {}
    for model, port, options in _MODELS:
        if _check_model(model, port):
            with _status_lock:
                _model_status[model] = {"loaded": True, "port": port, "cached": True, "ts": time.time()}
            results[model] = "already_loaded"
        else:
            ok = _load_model(model, port, options)
            results[model] = "loaded" if ok else "failed"
    return results


def _health_loop():
    while True:
        time.sleep(_HEALTH_INTERVAL)
        for model, port, options in _MODELS:
            if not _check_model(model, port):
                logger.warning(f"Model evicted: {model} on port {port} — reloading")
                _load_model(model, port, options)


class _ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send_json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            with _status_lock:
                all_loaded = all(s.get("loaded") for s in _model_status.values())
            self._send_json(200, {
                "status": "ready" if all_loaded and len(_model_status) == len(_MODELS) else "loading",
                "models": dict(_model_status),
            })
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except Exception:
            self._send_json(400, {"error": "bad request"})
            return

        if self.path == "/ensure-loaded":
            results = _ensure_all_loaded()
            self._send_json(200, {"results": results})
        else:
            self._send_json(404, {"error": "not found"})


def main():
    import argparse
    parser = argparse.ArgumentParser(description="HME Ollama persistence daemon")
    parser.add_argument("--port", type=int, default=7735)
    args = parser.parse_args()

    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    def _cleanup(signum, frame):
        try:
            os.unlink(PID_FILE)
        except OSError:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, _cleanup)
    signal.signal(signal.SIGINT, _cleanup)

    logger.info(f"Ollama daemon starting on port {args.port} (pid={os.getpid()})")

    init_thread = threading.Thread(target=_ensure_all_loaded, daemon=True)
    init_thread.start()

    health_thread = threading.Thread(target=_health_loop, daemon=True)
    health_thread.start()

    server = _ThreadingHTTPServer(("127.0.0.1", args.port), _Handler)
    logger.info(f"Ollama daemon listening on 127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            os.unlink(PID_FILE)
        except OSError:
            pass


if __name__ == "__main__":
    main()
