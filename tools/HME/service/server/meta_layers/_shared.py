"""Shared module-level state + constants for meta_layers package.

Submodules access state via `from . import _shared` + `_shared.<name>`
so that reassignment from the caller (meta_observer.start() sets
`meta_layers._shared._ms = ...`) is visible to every function across
the package. Direct `from ._shared import _ms` would create a local
binding that doesn't see reassignments.
"""
from __future__ import annotations

import logging
import os
import sys
import threading

# Ensure tools/HME/service/ is on sys.path so `from hme_env import ENV` works
# regardless of import order.
_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)

from hme_env import ENV  # noqa: E402

logger = logging.getLogger("HME.meta")

# Interval constants
_HEARTBEAT_INTERVAL = 30
_MONITOR_CHECK_INTERVAL = 45
_CORRELATION_WINDOW = 3600
_NARRATION_INTERVAL = 300
_MAX_NARRATIVE_LINES = 500
_ENV_CHECK_INTERVAL = 180
_ENTANGLE_INTERVAL = 120
_COUNTERFACTUAL_FILE_SUFFIX = "hme-counterfactuals.jsonl"
_SYNTHESIS_WINDOW = 3600  # 1 hour of synthesis records for pattern detection
_SYNTHESIS_PATTERN_INTERVAL = 1800  # 30 minutes
_INTENT_INTERVAL = 120              # 2 minutes
_ARCHAEOLOGY_INTERVAL = 21600       # 6 hours

# Mutable module-level state — assigned from meta_observer at startup
# and mutated by submodule functions during the loop.
_ms = None  # type: ignore — MetaState set by meta_observer.start()

# L13: monitor-thread watchdog
_monitor_thread_ref: threading.Thread | None = None
_monitor_restart_count = 0

# L14: correlation snapshot cache
_last_correlations: dict = {}

# L15: environment scan baseline
_last_env_snapshot: dict = {}

# L17: active predictions awaiting outcome
_predictions: list[dict] = []

# Run-history layer
_run_history_dir = ""

# Intent classification snapshot
_current_intent: dict = {}

# Last-fired timestamps for interval-gated submodules (read/updated by
# meta_observer's main loop).
_last_narration_ts: float = 0.0
_last_env_ts: float = 0.0
_last_entangle_ts: float = 0.0
_last_synthesis_pattern_ts: float = 0.0
_last_intent_ts: float = 0.0
_last_archaeology_ts: float = 0.0
_last_kb_confidence_ts: float = 0.0
