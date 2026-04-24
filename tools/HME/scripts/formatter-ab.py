#!/usr/bin/env python3
"""Character-level formatter AB harness.

Registers formatter variants for HME tool footers and records which
variant was used per tool_result. When the agent's downstream tool
calls are scanned, per-variant acted-upon rates can be compared —
measuring whether `[HME:edit]` vs `<hme:edit>` vs `— hme edit —` has
measurably different agent-attention behavior.

MVP: registry of variants + selector + logger. Actual measurement of
"downstream acted-upon" requires transcript-walking that comes with
the agent-patterns DB (B) — see recent-turn scan logic there.

Usage from middleware:
  from formatter_ab import select_variant, log_variant_usage
  marker = select_variant('edit_context', default='[HME:edit]')
  footer = f'{marker} {body}'
  log_variant_usage('edit_context', marker)

The selector rotates deterministically per turn-hash so a single
session gets consistent formatting (not flip-flopping mid-session)
while different sessions get different variants for comparison.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path


ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parent.parent.parent.parent)
LOG = ROOT / "output" / "metrics" / "hme-formatter-ab.jsonl"


# Registry: formatter_name → list of variant strings. First entry is the
# "control" (current production); subsequent are treatments.
_VARIANTS = {
    "edit_context":   ["[HME:edit]",  "<hme:edit>", "— hme edit —"],
    "read_context":   ["[HME:read]",  "<hme:read>", "— hme read —"],
    "dir_context":    ["[HME dir:",   "<hme dir ", "— hme dir "],
    "bash_err":       ["[err]",       "<err>",     "— err —"],
}


def _turn_hash(session_id: str | None = None) -> int:
    """Stable integer per session so a whole session uses one variant."""
    key = (session_id or os.environ.get("HME_SESSION_ID") or
           str(int(time.time()) // 86400))  # daily rotation fallback
    h = hashlib.sha256(key.encode()).digest()
    return int.from_bytes(h[:4], "big")


def select_variant(formatter_name: str, session_id: str | None = None,
                   default: str | None = None) -> str:
    variants = _VARIANTS.get(formatter_name)
    if not variants:
        return default or ""
    idx = _turn_hash(session_id) % len(variants)
    return variants[idx]


def log_variant_usage(formatter_name: str, variant: str,
                      session_id: str | None = None) -> None:
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG, "a") as f:
            f.write(json.dumps({
                "ts": int(time.time()),
                "formatter": formatter_name,
                "variant": variant,
                "session": session_id or os.environ.get("HME_SESSION_ID", ""),
            }) + "\n")
    except OSError:
        pass


if __name__ == "__main__":
    # Quick self-test: show which variant the current session would use.
    for name in _VARIANTS:
        print(f"{name}: {select_variant(name)!r}")
