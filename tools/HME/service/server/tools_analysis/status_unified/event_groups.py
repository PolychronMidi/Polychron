"""Telemetry event groups for status modes."""
from __future__ import annotations

import os
import sys

from server import context as ctx


def activity_event_names(group: str) -> set[str]:
    activity_dir = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "activity")
    if activity_dir not in sys.path:
        sys.path.insert(0, activity_dir)
    from event_registry import group_names  # noqa: WPS433
    return group_names(group, stream="activity")
