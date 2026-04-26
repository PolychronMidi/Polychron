"""llama.cpp persistence daemon — supervisor, RAG router, health proxy.

Runs on port 7735, writes PID to /tmp/hme-llamacpp-daemon.pid.

Owns:
  1. llama-server supervisor — spawn/adopt/restart arbiter + coder
     instances. Enforces the architecture invariant: each model owns
     its GPU end-to-end. Full offload only (n_gpu_layers=999).
     Refuses spawn + registers CRITICAL LIFESAVER on offload violation.
  2. RAG routing flag — GET /rag-route returns "gpu" or "cpu" based
     on the per-GPU busy flag. Callers on a given GPU route to the
     CPU mirror while its instance is generating.
  3. Generation proxy — POST /generate translates llamacpp-shape
     /api/generate calls into llama-server OpenAI /v1/chat/completions,
     enforcing a hard wall-clock cap.
  4. Health aggregation — GET /health returns combined supervisor +
     instance status. Used by the MCP shim startup probe.

Usage: python3 -m llamacpp_daemon [--port 7735]

Package split R98 (was 1234-line llamacpp_daemon.py). Submodules:
  _boot.py              env + version + log rotation + TRAINING_LOCK
  instance_spec.py      InstanceSpec dataclass + default topology
  supervisor.py         Supervisor class (orchestration)
  supervisor_helpers.py stateless probes + GPU-fit + topology assert
  gpu_state.py          per-GPU busy flags + RAG route
  generate_proxy.py     /generate translator
  indexing.py           indexing-mode orchestrator
  http_server.py        _ThreadingHTTPServer + handler factory
  __main__.py           argv parsing + thread wiring + serve_forever
"""
from __future__ import annotations

# Public re-exports preserve the flat-module API that existing callers
# (`import llamacpp_daemon; llamacpp_daemon.arbiter_busy_set()` etc.) rely on.
from ._boot import (  # noqa: F401
    DAEMON_VERSION, PID_FILE, TRAINING_LOCK, _training_locked, logger,
)
from .instance_spec import InstanceSpec, _default_instances  # noqa: F401
from .supervisor import Supervisor  # noqa: F401
from .gpu_state import (  # noqa: F401
    gpu_busy_set, gpu_busy_clear, gpu_busy_current, gpu_busy_snapshot,
    rag_gpu_busy_set, rag_gpu_busy_clear, _rag_gpu_busy_current,
    arbiter_busy_set, arbiter_busy_clear, rag_route,
    _rag_gpu_busy, _arbiter_busy,
)
from .generate_proxy import _generate_with_timeout, _resolve_base_url  # noqa: F401
from .indexing import run_indexing_mode  # noqa: F401

# Legacy alias: the original file exposed _run_indexing_mode
_run_indexing_mode = run_indexing_mode
