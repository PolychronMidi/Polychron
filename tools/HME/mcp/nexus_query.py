"""Read-only query API over tmp/hme-nexus.state.

Exists so non-hook callers (file watcher, analyzers, etc.) can check whether
a module has been BRIEFed without re-implementing the format. Keeps the nexus
protocol centralized.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

# Use the central .env loader. Must be on sys.path because this module lives
# in the same dir.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
from hme_env import ENV  # noqa: E402

_PROJECT_ROOT = ENV.require("PROJECT_ROOT")
_NEXUS_FILE = Path(_PROJECT_ROOT) / "tmp" / "hme-nexus.state"

# BRIEF TTL: briefs older than this count as stale. A BRIEF from 3 sessions
# ago shouldn't mark a current edit as "read-prior" — the agent doesn't
# remember what it read yesterday. 2h matches a typical chat session span.
_BRIEF_TTL_SEC = ENV.optional_int("HME_BRIEF_TTL_SEC", 7200)


def has_brief(target: str) -> bool:
    """True when tmp/hme-nexus.state contains a NON-STALE `BRIEF:<ts>:<target>`.
    Matches against the full payload — callers should pass the module name
    OR the abs path, depending on which form the BRIEF was registered with.
    Stale BRIEFs (> HME_BRIEF_TTL_SEC old, default 2h) don't count.
    """
    if not target:
        return False
    try:
        if not _NEXUS_FILE.exists():
            return False
        cutoff = int(time.time()) - _BRIEF_TTL_SEC
        with open(_NEXUS_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\n")
                if not line.startswith("BRIEF:"):
                    continue
                # Format: BRIEF:TIMESTAMP:PAYLOAD
                parts = line.split(":", 2)
                if len(parts) < 3:
                    continue
                try:
                    ts = int(parts[1])
                except ValueError:
                    continue
                if ts < cutoff:
                    continue  # stale — skip
                if parts[2] == target:
                    return True
    except OSError:
        return False
    return False
