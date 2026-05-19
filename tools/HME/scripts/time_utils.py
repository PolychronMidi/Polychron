"""Shared timestamp parsing helpers for HME scripts and status tools."""
from __future__ import annotations

import datetime


def activity_ts_seconds(value) -> float | None:
    """Normalize activity-log timestamps to epoch seconds.

    Activity rows are normally epoch seconds, but a few bridge paths have
    historically emitted ISO-8601 strings. Consumers must skip malformed values
    instead of crashing on mixed-type comparisons.
    """
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            pass
        try:
            return datetime.datetime.fromisoformat(
                text.replace("Z", "+00:00")
            ).timestamp()
        except ValueError:
            return None
    return None
