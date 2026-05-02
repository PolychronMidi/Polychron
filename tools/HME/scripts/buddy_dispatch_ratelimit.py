"""Buddy rate-limit detection -- extracted from buddy_dispatch_lifecycle.py.
Single function but ~90 lines of regex parsing distinct from the dispatch loop.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from buddy_dispatcher import (  # noqa: E402
    RATE_LIMIT_TEXT_RE, RATE_LIMIT_RESET_RE,
    _RATE_LIMIT_RESET_FIELDS, _RATE_LIMIT_RETRY_FIELDS,
    RATE_LIMIT_FALLBACK_BACKOFF_SECONDS,
)


def _detect_rate_limit(stderr: str, stdout: str) -> dict | None:
    """Inspect a buddy's exit text for rate-limit signals (lifted from
    skill-set Phase 13). Returns {detected: bool, reset_epoch: float|None,
    matched_text: str} on hit, None on no match. Reset epoch is parsed
    from the matched text; falls back to None (caller uses
    RATE_LIMIT_FALLBACK_BACKOFF_SECONDS in that case)."""
    combined = (stderr or "") + "\n" + (stdout or "")
    if not RATE_LIMIT_TEXT_RE.search(combined):
        return None
    reset_epoch = None
    m = RATE_LIMIT_RESET_RE.search(combined)
    if m:
        # retry-after-seconds field (relative from now) -- group 7
        if m.group(7):
            try:
                reset_epoch = time.time() + float(m.group(7))
            except ValueError:
                reset_epoch = None
        # epoch field present? (reset_time/resetsAt/etc.) -- group 6
        elif m.group(6):
            try:
                # If the value is small (< 10 years from epoch), treat
                # as relative seconds; otherwise absolute epoch. Real
                # Anthropic emits absolute epochs in 10-digit range.
                v = float(m.group(6))
                if v < 1_000_000_000:  # implausible absolute (year 2001 too old)
                    reset_epoch = time.time() + v
                else:
                    reset_epoch = v
            except ValueError:
                reset_epoch = None
        # "resets in N hours/minutes" form
        elif m.group(5):
            try:
                n = int(m.group(5))
                # hour vs minute disambiguation: re-check the matched substring
                if "min" in m.group(0).lower():
                    reset_epoch = time.time() + n * 60
                else:
                    reset_epoch = time.time() + n * 3600
            except ValueError:
                reset_epoch = None
        # "resets at HH:MM [am|pm] [(tz)]" form -- interpret as next
        # occurrence of that wall-clock time, TZ-aware when an IANA
        # zone name is captured (e.g. "7:50pm (Asia/Tokyo)"). Falls back
        # to local time when no TZ given OR when zoneinfo can't resolve
        # the captured name. Skill-set's live-failure traces show
        # Anthropic emits localized banners for non-US users -- without
        # TZ-aware parsing those resets get misinterpreted by N hours.
        elif m.group(1) and m.group(2):
            try:
                hh = int(m.group(1))
                mm = int(m.group(2))
                ampm = (m.group(3) or "").lower()
                tz_name = (m.group(4) or "").strip()
                if ampm == "pm" and hh < 12:
                    hh += 12
                elif ampm == "am" and hh == 12:
                    hh = 0
                tz = None
                if tz_name:
                    try:
                        from zoneinfo import ZoneInfo
                        tz = ZoneInfo(tz_name)
                    except (ImportError, Exception):
                        tz = None
                if tz is not None:
                    from datetime import datetime, timedelta
                    now_dt = datetime.now(tz)
                    target_dt = now_dt.replace(hour=hh, minute=mm, second=0, microsecond=0)
                    if target_dt <= now_dt:
                        target_dt = target_dt + timedelta(days=1)
                    reset_epoch = target_dt.timestamp()
                else:
                    now_lt = time.localtime()
                    target_lt = time.struct_time((
                        now_lt.tm_year, now_lt.tm_mon, now_lt.tm_mday,
                        hh, mm, 0,
                        now_lt.tm_wday, now_lt.tm_yday, now_lt.tm_isdst
                    ))
                    target_epoch = time.mktime(target_lt)
                    if target_epoch <= time.time():
                        target_epoch += 86400  # next day
                    reset_epoch = target_epoch
            except (ValueError, OverflowError):
                reset_epoch = None
    return {
        "detected": True,
        "reset_epoch": reset_epoch,
        "matched_text": (m.group(0) if m else "<no reset parse>")[:120],
    }


