"""HME status — unified system health and status hub (package split R101).

Merges check_pipeline + hme_admin(selftest) + coupling overview + trust
ecology into one 'is everything OK?' call with mode selection.
Auto-warms stale GPU contexts when detected.

Original 1244-line status_unified.py split into:
  mode_handlers.py       short _mode_* wrappers + _STATUS_MODES registry
  resource_reports.py    VRAM + freshness + budget reports
  lifecycle_reports.py   resume briefing + evolution priorities + trajectory
  metric_reports.py      staleness + coherence
  dispatch.py            status() function (main dispatcher)

Each submodule is imported at package load so MCP-tool decorators
fire at the right time. Adding a mode: implement the handler in
mode_handlers.py (decorated with `@ctx.mcp.tool(meta={"hidden": True})`)
and add the entry to `_STATUS_MODES`.
"""
from __future__ import annotations

# Load submodules so decorator-driven MCP tool registration fires.
from . import mode_handlers  # noqa: F401
from . import resource_reports  # noqa: F401
from . import lifecycle_reports  # noqa: F401
from . import metric_reports  # noqa: F401
from . import dispatch  # noqa: F401

# Public: the status() function itself.
from .dispatch import status  # noqa: F401
