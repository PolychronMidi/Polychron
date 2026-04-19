"""Read-only query API over tmp/hme-nexus.state.

Exists so non-hook callers (file watcher, analyzers, etc.) can check whether
a module has been BRIEFed without re-implementing the format. Keeps the nexus
protocol centralized.
"""
from __future__ import annotations

import os
from pathlib import Path

_PROJECT_ROOT = os.environ.get("PROJECT_ROOT", "/home/jah/Polychron")
_NEXUS_FILE = Path(_PROJECT_ROOT) / "tmp" / "hme-nexus.state"


def has_brief(target: str) -> bool:
    """True when tmp/hme-nexus.state contains `BRIEF:<ts>:<target>`.
    Matches against the full payload — callers should pass the module name
    OR the abs path, depending on which form the BRIEF was registered with.
    """
    if not target:
        return False
    try:
        if not _NEXUS_FILE.exists():
            return False
        with open(_NEXUS_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\n")
                if not line.startswith("BRIEF:"):
                    continue
                # Format: BRIEF:TIMESTAMP:PAYLOAD
                parts = line.split(":", 2)
                if len(parts) < 3:
                    continue
                if parts[2] == target:
                    return True
    except OSError:
        return False
    return False
