"""Entry point — `python3 -m llamacpp_daemon [--port N]`."""
from __future__ import annotations

import argparse
import os
import signal
import sys
import threading

from ._boot import logger, PID_FILE
from .supervisor import Supervisor
from .http_server import _ThreadingHTTPServer, make_handler, health_loop


def _logged_thread(name: str, fn):
    """Wrap a thread target so exceptions get logged with traceback.
    Bare threading.Thread(target=fn) silently swallows exceptions —
    this is the pattern behind the original 'not started' indexing-mode
    bug that went unnoticed for so long. Every thread surfaces its
    own failure or it might as well not run."""
    def _wrapped():
        try:
            fn()
        except Exception:
            import traceback as _tb
            logger.error(f"daemon thread {name!r} crashed:\n{_tb.format_exc()}")
    return threading.Thread(target=_wrapped, daemon=True, name=name)


def main():
    parser = argparse.ArgumentParser(description="HME llama.cpp persistence daemon")
    parser.add_argument("--port", type=int, default=7735)
    args = parser.parse_args()

    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    def _cleanup(signum, frame):
        try:
            os.unlink(PID_FILE)
        except OSError:  # silent-ok: signal-handler PID cleanup; file may already be absent
            pass
        sys.exit(0)
    signal.signal(signal.SIGTERM, _cleanup)
    signal.signal(signal.SIGINT, _cleanup)

    supervisor = Supervisor()
    supervisor.configure()

    logger.info(f"llamacpp daemon starting on port {args.port} (pid={os.getpid()})")

    # Pre-boot topology assertion: catch environment problems at startup
    # instead of letting them silently propagate into mid-operation OOMs.
    try:
        supervisor.assert_topology_ready()
    except RuntimeError as _topo_err:
        logger.error(f"daemon: topology assertion failed — refusing to start:\n  {_topo_err}")
        try:
            os.unlink(PID_FILE)
        except OSError:  # silent-ok: boot-abort PID cleanup after assertion failure
            pass
        sys.exit(2)

    _logged_thread("supervisor-init", supervisor.ensure_all_running).start()
    _logged_thread("supervisor-health", lambda: health_loop(supervisor)).start()

    server = _ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(supervisor))
    logger.info(f"llamacpp daemon listening on 127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:  # silent-ok: normal CTRL-C shutdown
        pass
    finally:
        try:
            os.unlink(PID_FILE)
        except OSError:  # silent-ok: shutdown PID cleanup
            pass


if __name__ == "__main__":
    main()
