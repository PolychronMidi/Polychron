"""Routed metric paths for pipeline HME scripts."""
from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[2]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from hme_paths import (
    COMPOSITION_METRICS_DIR,
    HME_METRICS_DIR,
    is_hme_metric_name,
    metric_path as _metric_path,
    project_metric,
    read_metric_path as _read_metric_path,
    write_metric_path as _write_metric_path,
)

METRICS_DIR = str(HME_METRICS_DIR)
PROJECT_METRICS_DIR = str(COMPOSITION_METRICS_DIR)


def metric_path(*parts: str) -> str:
    return str(_metric_path(*parts))


def read_metric_path(*parts: str) -> str:
    return str(_read_metric_path(*parts))


def write_metric_path(*parts: str) -> str:
    return str(_write_metric_path(*parts))


def project_metric_path(*parts: str) -> str:
    return str(project_metric(*parts))


def is_hme_metric(*parts: str) -> bool:
    return is_hme_metric_name(*parts)


def ensure_parent(pathish: str) -> None:
    Path(pathish).parent.mkdir(parents=True, exist_ok=True)
