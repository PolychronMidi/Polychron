"""Shared JSON and metric path helpers for tools/HME/scripts."""
from __future__ import annotations

import json
import os
from pathlib import Path

from hme_paths import (
    COMPOSITION_METRICS_DIR,
    PROJECT_ROOT as _PROJECT_ROOT_PATH,
    HME_METRICS_DIR,
    is_hme_metric_name,
    metric_path,
    read_hme_metric,
    read_metric_path,
)

PROJECT_ROOT = str(_PROJECT_ROOT_PATH)
METRICS_DIR = str(COMPOSITION_METRICS_DIR)
HME_METRICS = str(HME_METRICS_DIR)


def _resolve(pathish) -> Path:
    p = Path(pathish)
    if p.is_absolute():
        return p
    parts = p.parts
    if len(parts) >= 3 and parts[:3] == ("src", "output", "metrics"):
        rest = parts[3:]
        if rest and is_hme_metric_name(*rest):
            return read_hme_metric(*rest)
        return read_metric_path(*rest)
    return _PROJECT_ROOT_PATH / p


def load_json(pathish):
    """Load JSON from a project-relative, absolute, or routed metric path."""
    full = _resolve(pathish)
    if not full.is_file():
        return None
    try:
        with open(full, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def load_jsonl_tail(pathish, n=5):
    """Load last N JSONL objects. Malformed rows are skipped."""
    full = _resolve(pathish)
    if not full.is_file():
        return []
    try:
        with open(full, encoding="utf-8") as f:
            lines = [l.strip() for l in f if l.strip()]
    except Exception:
        return []
    out = []
    for line in lines[-n:]:
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def load_jsonl_all(pathish):
    """Load all JSONL objects. Malformed rows are skipped."""
    full = _resolve(pathish)
    if not full.is_file():
        return []
    try:
        with open(full, encoding="utf-8") as f:
            lines = [l.strip() for l in f if l.strip()]
    except Exception:
        return []
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out
