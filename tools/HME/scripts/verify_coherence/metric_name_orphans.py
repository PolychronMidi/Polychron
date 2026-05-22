"""Metric-name orphan invariant.

Closes the metric-registry loop in the reverse direction. The
cross-language-contracts verifier locks PROJECT_METRIC_NAMES and
HME_METRIC_NAMES in lock-step between Py and JS; this verifier checks
that every name in those registries is *actually used* somewhere in
tracked source. A registry entry whose code-side writer has been
deleted is an orphan and FAILs.

A "use" is any tracked file (other than the registry declarations
themselves) that contains the metric name as a literal string. The
intent is loose enough that test fixtures, dashboards, and doc
references all count -- the failure mode this targets is "registry
entry survives long after the code that wrote that file is gone."

Source of truth for the registry: tools/HME/config/cross_language_contracts.json
Declaration sites (excluded from writer count):
  tools/HME/scripts/hme_paths.py
  tools/HME/proxy/hme_paths.js
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from ._base import (
    FAIL,
    PASS,
    SKIP,
    VerdictResult,
    Verifier,
    _PROJECT,
    _result,
    failed,
    passed,
    register,
    skipped,
)

REGISTRY_REL = "tools/HME/config/cross_language_contracts.json"

DECLARATION_FILES = {
    "tools/HME/scripts/hme_paths.py",
    "tools/HME/proxy/hme_paths.js",
    REGISTRY_REL,
}


def _metric_name_sets(registry: dict) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for entry in registry.get("shared_sets") or []:
        name = entry.get("name", "")
        if name.endswith("_METRIC_NAMES"):
            values = entry.get("values") or []
            if isinstance(values, list):
                out[name] = [str(v) for v in values]
    return out


def _writers(root: Path, literal: str) -> list[str]:
    try:
        rc = subprocess.run(
            ["git", "-C", str(root), "grep", "-l", "--cached", "-F", literal],
            capture_output=True, text=True, timeout=30,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return []
    if rc.returncode not in (0, 1):
        return []
    hits = [line.strip() for line in rc.stdout.splitlines() if line.strip()]
    return [h for h in hits if h not in DECLARATION_FILES]


@register
class MetricNameOrphansVerifier(Verifier):
    """Every metric-registry entry must have at least one non-declaration writer."""

    name = "metric-name-orphans"
    category = "state"
    subtag = "drift-detection"
    weight = 1.0

    def run(self) -> VerdictResult:
        root = Path(_PROJECT)
        registry_path = root / REGISTRY_REL
        if not registry_path.is_file():
            return skipped(summary=f"no registry at {REGISTRY_REL}")
        try:
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            return failed(score=0.0, summary=f"registry unreadable -- {e}")

        sets = _metric_name_sets(registry)
        if not sets:
            return skipped(summary="no *_METRIC_NAMES entries in registry")

        orphans: list[str] = []
        checked = 0
        for set_name, values in sets.items():
            for v in values:
                checked += 1
                if not _writers(root, v):
                    orphans.append(f"{set_name}: {v} -- no tracked writer outside declarations")

        if not orphans:
            return passed(score=1.0, summary=f"{checked} metric name(s) across {len(sets)} registry set(s) "
                "all have writers")
        score = max(0.0, 1.0 - len(orphans) / max(checked, 1))
        return _result(
            FAIL, score,
            f"{len(orphans)}/{checked} metric name(s) are orphaned in the registry",
            orphans[:30],
        )
