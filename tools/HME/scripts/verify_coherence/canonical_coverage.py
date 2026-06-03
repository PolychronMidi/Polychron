"""Canonical-source coverage invariant (meta-coverage of the enforcement lattice).

The recurring self-coherence failure class is the *ungated canonical source*:
a file declares itself the single source of truth, but nothing FAILS when a
duplicate or circumvention drifts away from it. This verifier closes the loop
on the loop-closers: every entry in tools/HME/config/canonical-sources.json
must name a source that exists, a guard (contract test or verifier) that
exists, and the guard must reference the source via `marker` so it is a REAL
gate and not a stale pointer. The registry is itself an entry (fixed point),
so the lattice gates its own input.
"""
from __future__ import annotations

import json
from pathlib import Path

from ._base import (
    VerdictResult,
    Verifier,
    _PROJECT,
    failed,
    passed,
    register,
)

REGISTRY_REL = "tools/HME/config/canonical-sources.json"


def evaluate_entries(root: Path, entries: list) -> list[str]:
    """Pure evaluator: return a list of issue strings (empty = full coverage).

    No env/_base dependency, so the contract test can exercise it directly
    against synthetic registries in a temp root.
    """
    issues: list[str] = []
    for idx, entry in enumerate(entries):
        if not isinstance(entry, dict):
            issues.append(f"#{idx}: entry is not an object")
            continue
        source = entry.get("source")
        guard = entry.get("guard")
        marker = entry.get("marker")
        label = source or f"#{idx}"
        if not isinstance(source, str) or not source:
            issues.append(f"#{idx}: missing 'source'")
            continue
        if not isinstance(guard, str) or not guard:
            issues.append(f"{label}: missing 'guard'")
            continue
        if not isinstance(marker, str) or not marker:
            issues.append(f"{label}: missing 'marker'")
            continue
        if not (root / source).is_file():
            issues.append(f"{label}: canonical source does not exist on disk")
            continue
        guard_path = root / guard
        if not guard_path.is_file():
            issues.append(f"{label}: guard {guard} does not exist on disk")
            continue
        try:
            guard_text = guard_path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            issues.append(f"{label}: guard {guard} unreadable ({exc})")
            continue
        if marker not in guard_text:
            issues.append(
                f"{label}: guard {guard} does not reference marker '{marker}' "
                "-- stale or non-binding gate"
            )
    return issues


def _self_entry_present(entries: list) -> bool:
    return any(
        isinstance(e, dict) and e.get("source") == REGISTRY_REL
        for e in entries
    )


@register
class CanonicalSourceCoverageVerifier(Verifier):
    """Every declared single source of truth must have a guard that fails on drift."""

    name = "canonical-source-coverage"
    category = "meta"
    subtag = "interface-contract"
    weight = 1.5

    def run(self) -> VerdictResult:
        root = Path(_PROJECT)
        reg_path = root / REGISTRY_REL
        if not reg_path.is_file():
            return failed(score=0.0, summary=f"{REGISTRY_REL} missing")
        try:
            data = json.loads(reg_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            return failed(score=0.0, summary=f"{REGISTRY_REL} unreadable -- {exc}")
        entries = data.get("sources") if isinstance(data, dict) else None
        if not isinstance(entries, list) or not entries:
            return failed(score=0.0, summary=f"{REGISTRY_REL} has no 'sources' list")

        issues = evaluate_entries(root, entries)
        if not _self_entry_present(entries):
            issues.append(
                f"{REGISTRY_REL}: registry must include itself as an entry (fixed point)"
            )
        if not issues:
            return passed(
                score=1.0,
                summary=f"{len(entries)} canonical source(s) each gated by an existing, binding guard",
            )
        score = max(0.0, 1.0 - len(issues) / 10.0)
        return failed(
            score=score,
            summary=f"{len(issues)} ungated/stale canonical source(s)",
            details=issues[:30],
        )
