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
TRAINING_LOCK = os.environ.get("HME_TRAINING_LOCK", "/home/jah/Polychron/tmp/hme-training.lock")


def _training_locked() -> bool:
    """Skip all auto-load/reload when training lock exists — frees GPU for training."""
    return os.path.exists(TRAINING_LOCK)

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
_DEFAULT_WALL_TIMEOUT = 45  # hard wall-clock cap for /generate proxy

_TMPFS_PATHS = ["/mnt/ollama-buffer-gpu0", "/mnt/ollama-buffer-gpu1"]


def _warm_cache_dir() -> str:
    for tp in _TMPFS_PATHS:
        if os.path.ismount(tp):
            return tp
    project_root = os.environ.get("PROJECT_ROOT", "")
    if project_root:
        return os.path.join(project_root, "tools", "HME", "warm-context-cache")
    return "/tmp/hme-warm-cache"


def _warm_cache_status() -> dict:
    """Report age and presence of warm KV cache files for each model."""
    cache_dir = _warm_cache_dir()
    now = time.time()
    result = {}
    for model, _port, _opts in _MODELS:
        stem = model.replace(":", "-").replace("/", "-")
        cache_file = os.path.join(cache_dir, f"warm-kv-{stem}.json")
        if os.path.exists(cache_file):
            age_s = round(now - os.path.getmtime(cache_file))
            result[model] = {"cached": True, "age_s": age_s, "fresh": age_s < 3600}
        else:
            result[model] = {"cached": False}
    return result


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
    if _training_locked():
        logger.info(f"Training lock present ({TRAINING_LOCK}); skipping _ensure_all_loaded")
        return {"status": "training_locked"}
    for model, port, options in _MODELS:
        if _check_model(model, port):
            with _status_lock:
                _model_status[model] = {"loaded": True, "port": port, "cached": True, "ts": time.time()}
            results[model] = "already_loaded"
        else:
            ok = _load_model(model, port, options)
            results[model] = "loaded" if ok else "failed"
    return results


def _resolve_port(model: str) -> int:
    for m, port, _ in _MODELS:
        if m == model:
            return port
    return _PORT_GPU0


def _generate_with_timeout(payload: dict, wall_timeout: float) -> dict:
    """Proxy a generation request to the correct Ollama port with a hard wall-clock cap.

    Runs the Ollama HTTP call in a daemon thread. If the thread doesn't finish
    within wall_timeout seconds, returns a timeout error — the daemon thread
    is abandoned (daemon=True ensures cleanup on process exit).
    """
    model = payload.get("model", _LOCAL_MODEL)
    port = _resolve_port(model)
    url = f"http://localhost:{port}/api/generate"
    payload["stream"] = False
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})

    result_box = [None, None]  # [response_dict, error_string]

    def _worker():
        try:
            with urllib.request.urlopen(req, timeout=wall_timeout) as resp:
                result_box[0] = json.loads(resp.read())
        except Exception as e:
            result_box[1] = f"{type(e).__name__}: {e}"

    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    t.join(timeout=wall_timeout)

    if t.is_alive():
        logger.warning(f"/generate: wall timeout ({wall_timeout}s) for {model} on port {port}")
        return {"error": f"wall timeout after {wall_timeout}s", "timeout": True}

    if result_box[1]:
        return {"error": result_box[1], "timeout": "timed out" in result_box[1].lower()}

    return result_box[0] or {"error": "empty response"}


def _health_loop():
    while True:
        time.sleep(_HEALTH_INTERVAL)
        if _training_locked():
            continue
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
            warm_status = _warm_cache_status()
            self._send_json(200, {
                "status": "ready" if all_loaded and len(_model_status) == len(_MODELS) else "loading",
                "models": dict(_model_status),
                "warm_caches": warm_status,
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
        elif self.path == "/generate":
            if "model" not in body:
                self._send_json(400, {"error": "model required"})
                return
            wall_timeout = float(body.pop("wall_timeout", _DEFAULT_WALL_TIMEOUT))
            result = _generate_with_timeout(body, wall_timeout)
            if "error" in result:
                self._send_json(504 if result.get("timeout") else 500, result)
            else:
                self._send_json(200, result)
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
