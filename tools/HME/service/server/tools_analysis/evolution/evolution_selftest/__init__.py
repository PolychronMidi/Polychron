"""HME self-test and hot-reload — package split R102.

Original 1138-line evolution_selftest.py split into:
  _shared.py     RELOADABLE module list (single source of truth)
  hot_reload.py  hme_hot_reload — reload reloadable modules mid-session
  selftest.py    hme_selftest — 30+ probes across tool surface / llama / KB

Note: selftest.py stays at ~940 LOC because the probe function is one
cohesive sequence — each probe shares state (results list, warning
context) with the outer function. Extracting probes to helpers is a
bigger refactor than this split was scoped for.
"""
from __future__ import annotations

# Decorator-driven MCP tool registration fires on submodule import.
from . import hot_reload  # noqa: F401
from . import selftest  # noqa: F401
from .hot_reload import hme_hot_reload  # noqa: F401
from .selftest import hme_selftest  # noqa: F401
from ._shared import RELOADABLE  # noqa: F401
