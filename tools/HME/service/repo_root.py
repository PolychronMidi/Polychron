"""Repo root resolver -- fail-fast, no host-specific hardcoded fallback.

Resolution order:
  1. PROJECT_ROOT env var (set by .env via hooks)
  2. CLAUDE_PROJECT_DIR env var (set by Claude Code)
  3. Walk up from this file looking for .env + .git
Raises RuntimeError if none resolve. Replaces the host-path fallback
pattern previously copy-pasted across 7+ Python sites.
"""
from __future__ import annotations

import os
from pathlib import Path


def resolve() -> str:
    for var in ("PROJECT_ROOT", "CLAUDE_PROJECT_DIR"):
        val = os.environ.get(var)  # env-ok: low-level root bootstrap
        if val and os.path.isfile(os.path.join(val, ".env")):
            return val
    cur = Path(__file__).resolve().parent
    while cur != cur.parent:
        if (cur / ".env").is_file() and (cur / ".git").is_dir():
            return str(cur)
        cur = cur.parent
    raise RuntimeError("repo_root.resolve: cannot locate repo root "
                       "(PROJECT_ROOT, CLAUDE_PROJECT_DIR, and walk-up all failed)")
