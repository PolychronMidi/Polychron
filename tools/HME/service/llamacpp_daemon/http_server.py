"""HTTP daemon — _ThreadingHTTPServer + _Handler + health loop.

Exposes the daemon's control surface on 127.0.0.1:<port>.
"""
from __future__ import annotations

import json
import threading
import time
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs

from ._boot import (
    logger, DAEMON_VERSION, _DEFAULT_WALL_TIMEOUT, _HEALTH_INTERVAL,
    _training_locked,
)
from .gpu_state import (
    gpu_busy_set, gpu_busy_clear, gpu_busy_current, gpu_busy_snapshot,
    _rag_gpu_busy_current, arbiter_busy_set, arbiter_busy_clear,
)
from .generate_proxy import _generate_with_timeout
from .indexing import run_indexing_mode


class _ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def health_loop(supervisor):
    """Periodic health-tick thread target."""
    while True:
        time.sleep(_HEALTH_INTERVAL)
        try:
            supervisor.health_tick()
        except Exception as e:
            logger.error(f"supervisor health_tick failed: {e}")


def make_handler(supervisor):
    """Factory: build a request handler bound to the given supervisor.

    Used to be a module-level class with a singleton reference. Factoring
    it as a closure lets tests instantiate independent handlers without
    global state, and keeps the supervisor dependency explicit.
    """

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
            parsed = urlparse(self.path)
            qs = parse_qs(parsed.query)
            device = (qs.get("device") or [None])[0]

            if parsed.path == "/version":
                self._send_json(200, {"version": DAEMON_VERSION, "component": "daemon"})
            elif parsed.path == "/health":
                stats = supervisor.stats()
                all_healthy = all(
                    s["last_health_ok"] > time.time() - _HEALTH_INTERVAL * 2
                    for s in stats
                ) if stats else False
                legacy_busy = _rag_gpu_busy_current()
                self._send_json(200, {
                    "status": "ready" if all_healthy else "degraded",
                    "training_locked": _training_locked(),
                    "instances": stats,
                    "arbiter_busy": legacy_busy,
                    "rag_gpu_busy": legacy_busy,
                    "gpu_busy": gpu_busy_snapshot(),
                })
            elif parsed.path == "/rag-route":
                busy = (gpu_busy_current(device) if device is not None
                        else _rag_gpu_busy_current())
                self._send_json(200, {
                    "device": device, "route": "cpu" if busy else "gpu",
                    "arbiter_busy": busy, "rag_gpu_busy": busy,
                })
            elif parsed.path == "/stats":
                self._send_json(200, {"instances": supervisor.stats()})
            else:
                self._send_json(404, {"error": "not found"})

        def do_POST(self):
            try:
                cl = self.headers.get("Content-Length")
                length = int(cl) if cl is not None else 0
                body = json.loads(self.rfile.read(length)) if length else {}
            except (ValueError, UnicodeDecodeError, OverflowError):
                self._send_json(400, {"error": "bad request"})
                return

            if self.path == "/ensure-loaded":
                self._send_json(200, {"results": supervisor.ensure_all_running()})
            elif self.path == "/generate":
                if "model" not in body:
                    self._send_json(400, {"error": "model required"})
                    return
                wall_timeout = float(body.pop("wall_timeout", _DEFAULT_WALL_TIMEOUT))
                result = _generate_with_timeout(
                    body, wall_timeout, supervisor.instances(),
                )
                self._send_json(
                    (504 if result.get("timeout") else 500) if "error" in result else 200,
                    result,
                )
            elif self.path == "/arbiter-busy":
                self._handle_busy_flag(body, arbiter_busy_set, arbiter_busy_clear,
                                       key="arbiter_busy")
            elif self.path == "/gpu-busy":
                device = body.get("device", "")
                if not device:
                    self._send_json(400, {"error": "device required (e.g. Vulkan1)"})
                    return
                state = body.get("state", "")
                if state == "set":
                    gpu_busy_set(device)
                    self._send_json(200, {"device": device, "busy": True})
                elif state == "clear":
                    gpu_busy_clear(device)
                    self._send_json(200, {"device": device, "busy": False})
                else:
                    self._send_json(400, {"error": "state must be 'set' or 'clear'"})
            elif self.path == "/suspend":
                self._handle_named_op(body, supervisor.suspend)
            elif self.path == "/resume":
                self._handle_named_op(body, supervisor.resume)
            elif self.path == "/indexing-mode":
                self._handle_indexing_mode()
            else:
                self._send_json(404, {"error": "not found"})

        def _handle_busy_flag(self, body, set_fn, clear_fn, *, key):
            state = body.get("state", "")
            if state == "set":
                set_fn()
                self._send_json(200, {key: True})
            elif state == "clear":
                clear_fn()
                self._send_json(200, {key: False})
            else:
                self._send_json(400, {"error": "state must be 'set' or 'clear'"})

        def _handle_named_op(self, body, op):
            name = body.get("name", "")
            if not name:
                self._send_json(400, {"error": "name required (e.g. 'coder')"})
            else:
                self._send_json(200, op(name))

        def _handle_indexing_mode(self):
            result = {"error": "not started"}

            def _run():
                nonlocal result
                try:
                    result = run_indexing_mode()
                except Exception as e:
                    tb = traceback.format_exc()
                    logger.error(f"indexing-mode: run_indexing_mode raised: {tb}")
                    result = {"error": f"indexing-mode crashed: {type(e).__name__}: {e}"}

            t = threading.Thread(target=_run)
            t.start()
            t.join(timeout=580)  # slightly under the client's 600s timeout
            if t.is_alive():
                result = {"error": "indexing mode timed out (580s)"}
            self._send_json(200, result)

    return _Handler
