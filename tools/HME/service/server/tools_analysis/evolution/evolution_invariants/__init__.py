"""Declarative invariant battery — package split R103.

Original 1070-line evolution_invariants.py split into:
  _base.py      invariant loader + path resolution + exclusion helper
  checks.py     all _check_* invariant handlers (one per invariant type)
  dispatch.py   _eval dispatcher + check_invariants public entry + history persist
"""
from __future__ import annotations

from .dispatch import check_invariants  # noqa: F401
from ._base import _load_invariants  # noqa: F401
