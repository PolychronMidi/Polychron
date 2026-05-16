"""Shared METRICS_DIR accessor for pipeline HME scripts."""
from __future__ import annotations

import os

METRICS_DIR = os.environ.get("METRICS_DIR")
if not METRICS_DIR:
    raise RuntimeError("METRICS_DIR is required")
