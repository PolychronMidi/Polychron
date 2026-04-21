"""Shared helpers for scripts/hme/* tools.

Deduplicates the PROJECT_ROOT resolution + JSON/jsonl loading logic that
was copy-pasted across substrate-view, why-invariant, freeze-check,
pattern-registry. Single source of truth for path conventions.
"""
from __future__ import annotations
import json
import os

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def load_json(relpath):
    """Load a JSON file relative to PROJECT_ROOT. Returns None on any error."""
    full = os.path.join(PROJECT_ROOT, relpath)
    if not os.path.isfile(full):
        return None
    try:
        with open(full, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def load_jsonl_tail(relpath, n=5):
    """Load last N lines of a JSONL file. Returns [] on any error."""
    full = os.path.join(PROJECT_ROOT, relpath)
    if not os.path.isfile(full):
        return []
    try:
        with open(full, encoding="utf-8") as f:
            lines = [l.strip() for l in f if l.strip()]
    except Exception:
        return []
    out = []
    for l in lines[-n:]:
        try:
            out.append(json.loads(l))
        except Exception:
            continue
    return out


def load_jsonl_all(relpath):
    """Load every line of a JSONL file. Returns [] on any error."""
    full = os.path.join(PROJECT_ROOT, relpath)
    if not os.path.isfile(full):
        return []
    try:
        with open(full, encoding="utf-8") as f:
            lines = [l.strip() for l in f if l.strip()]
    except Exception:
        return []
    out = []
    for l in lines:
        try:
            out.append(json.loads(l))
        except Exception:
            continue
    return out
