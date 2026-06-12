"""Env parity for verify_coherence specs that import the engine DIRECTLY
(without _lib/helpers). verify_coherence and its tooling fail loud when
PROJECT_ROOT / HME_METRICS_DIR / METRICS_DIR / HME_IGNORE_* are absent.

Importing this module at the top of a spec makes a bare `python3 <spec>.test.py`
self-sufficient -- matching what the canonical runner injects -- so a missing-env
KeyError can never masquerade as a real test failure. setdefault never overrides
a value the runner already exported.

Usage (one line, before importing verify_coherence):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
    import specenv  # noqa: F401
"""
from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]

os.environ.setdefault("PROJECT_ROOT", str(REPO_ROOT))
os.environ.setdefault("HME_METRICS_DIR", str(REPO_ROOT / "tools/HME/runtime/metrics"))
os.environ.setdefault("METRICS_DIR", str(REPO_ROOT / "src/output/metrics"))
os.environ.setdefault("HME_IGNORE_DIRS", "node_modules,.git,tmp,log,runtime")
os.environ.setdefault("HME_IGNORE_FILES", "package-lock.json,pnpm-lock.yaml")
os.environ.setdefault("HME_IGNORE_EXTS", ".log,.jsonl,.tmp")
