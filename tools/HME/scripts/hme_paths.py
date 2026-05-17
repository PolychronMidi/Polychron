from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3]).resolve()


def _under_root(value: str | None, fallback: Path) -> Path:
    if not value:
        return fallback
    candidate = Path(value).expanduser().resolve()
    try:
        candidate.relative_to(PROJECT_ROOT)
        return candidate
    except ValueError:
        return fallback


HME_RUNTIME_DIR = _under_root(
    os.environ.get("HME_RUNTIME_DIR"), PROJECT_ROOT / "tools" / "HME" / "runtime"
)
HME_METRICS_DIR = _under_root(os.environ.get("HME_METRICS_DIR"), HME_RUNTIME_DIR / "metrics")
HME_STATE_DIR = _under_root(os.environ.get("HME_STATE_DIR"), HME_RUNTIME_DIR / "state")
COMPOSITION_OUTPUT_DIR = _under_root(
    os.environ.get("COMPOSITION_OUTPUT_DIR"), PROJECT_ROOT / "src" / "output"
)
COMPOSITION_METRICS_DIR = _under_root(
    os.environ.get("COMPOSITION_METRICS_DIR") or os.environ.get("METRICS_DIR"),
    COMPOSITION_OUTPUT_DIR / "metrics",
)


def hme_metric(*parts: str) -> Path:
    return HME_METRICS_DIR.joinpath(*parts)


def hme_state(*parts: str) -> Path:
    return HME_STATE_DIR.joinpath(*parts)


def project_metric(*parts: str) -> Path:
    return COMPOSITION_METRICS_DIR.joinpath(*parts)
