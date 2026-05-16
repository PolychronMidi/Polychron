#!/usr/bin/env python3
"""Remove retired implementation references from HME session-state history."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

from _common import PROJECT_ROOT


STATE_PATH = os.path.join(PROJECT_ROOT, "tools", "HME", "runtime", "session-state.json")
LEGACY_STATE_PATH = os.path.join(PROJECT_ROOT, "tools", "HME", "session-state.json")
ARCHIVE_DIR = os.path.join(PROJECT_ROOT, "output", "metrics", "archive")
RETIRED_FRAGMENTS = (
    "_proxy_bridge.sh",
    "/hooks/statusline.sh",
    "direct_dispatch.sh",
    "BUDDY_SYSTEM",
    "buddy_init.sh",
    "buddy-primary",
    "buddy.sid",
    "hme-buddy",
    "i/buddy",
    "i/consult",
    "i/handoff",
)


def _contains_retired(value) -> bool:
    if isinstance(value, str):
        return any(fragment in value for fragment in RETIRED_FRAGMENTS)
    if isinstance(value, list):
        return any(_contains_retired(item) for item in value)
    if isinstance(value, dict):
        return any(_contains_retired(item) for item in value.values())
    return False


def _scrub(value):
    if isinstance(value, list):
        return [_scrub(item) for item in value if not _contains_retired(item)]
    if isinstance(value, dict):
        return {key: _scrub(item) for key, item in value.items()}
    return value


def _write_atomic(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def main() -> int:
    removed_legacy = False
    if not os.path.isfile(STATE_PATH):
        if os.path.isfile(LEGACY_STATE_PATH):
            os.makedirs(ARCHIVE_DIR, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            archive_path = os.path.join(ARCHIVE_DIR, f"legacy-session-state.{stamp}.json")
            with open(LEGACY_STATE_PATH, encoding="utf-8") as f:
                legacy_raw = f.read()
            _write_atomic(archive_path, legacy_raw)
            os.remove(LEGACY_STATE_PATH)
            print(f"[ok] removed legacy session state; archived original to {archive_path}")
            return 0
        print(f"[ok] {STATE_PATH}: missing; nothing to sanitize")
        return 0
    with open(STATE_PATH, encoding="utf-8") as f:
        raw = f.read()
    try:
        state = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[no] {STATE_PATH}:{e.lineno}:{e.colno}: invalid JSON: {e.msg}")
        return 1

    sanitized = _scrub(state)
    before = raw
    after = json.dumps(sanitized, indent=2) + "\n"
    if before == after:
        if os.path.isfile(LEGACY_STATE_PATH):
            os.remove(LEGACY_STATE_PATH)
            removed_legacy = True
        suffix = "; removed legacy tools/HME/session-state.json" if removed_legacy else ""
        print(f"[ok] {STATE_PATH}: no retired references found{suffix}")
        return 0

    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    archive_path = os.path.join(ARCHIVE_DIR, f"session-state.{stamp}.json")
    _write_atomic(archive_path, before)
    _write_atomic(STATE_PATH, after)
    if os.path.isfile(LEGACY_STATE_PATH):
        os.remove(LEGACY_STATE_PATH)
        removed_legacy = True
    suffix = "; removed legacy tools/HME/session-state.json" if removed_legacy else ""
    print(f"[ok] sanitized session state; archived original to {archive_path}{suffix}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
