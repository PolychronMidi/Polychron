"""Verifier self-coverage invariant.

For each module that exports a Verifier subclass into REGISTRY, a
matching test spec must exist at tools/HME/tests/specs/<module>.test.py
or .test.js. The waiver file pins pre-existing gaps as tracked debt;
adding a verifier module without either a test or an explicit waiver
entry FAILs the build. Conversely, a waiver entry whose module DOES
have a test is stale and also FAILs -- the waiver list can shrink but
never silently accumulate.

Waiver registry: tools/HME/config/verifier_test_waivers.json
Test spec directory: tools/HME/tests/specs/
"""
from __future__ import annotations

import json
from pathlib import Path

from ._base import (
    _PROJECT,
    Verifier,
    VerdictResult,
    _result,
    PASS,
    FAIL,
    WARN,
)

WAIVERS_REL = "tools/HME/config/verifier_test_waivers.json"
SPECS_REL = "tools/HME/tests/specs"


def _registry_modules() -> set[str]:
    from . import REGISTRY
    mods: set[str] = set()
    for v in REGISTRY:
        full = getattr(v.__class__, "__module__", "")
        if not full:
            continue
        basename = full.rsplit(".", 1)[-1]
        if basename in ("__init__", "_base"):
            continue
        mods.add(basename)
    mods.discard("verifier_self_coverage")
    return mods


def _has_test(specs_dir: Path, module: str) -> bool:
    return (specs_dir / f"{module}.test.py").is_file() or (
        specs_dir / f"{module}.test.js"
    ).is_file()


class VerifierSelfCoverageVerifier(Verifier):
    """Every verifier module needs a test spec or an explicit waiver entry."""

    name = "verifier-self-coverage"
    category = "code"
    subtag = "interface-contract"
    weight = 1.0
    kind = "static"

    def run(self) -> VerdictResult:
        root = Path(_PROJECT)
        specs_dir = root / SPECS_REL
        waivers_path = root / WAIVERS_REL

        waivered: set[str] = set()
        if waivers_path.is_file():
            try:
                data = json.loads(waivers_path.read_text(encoding="utf-8"))
                for entry in data.get("waivers") or []:
                    mod = entry.get("module") if isinstance(entry, dict) else None
                    if isinstance(mod, str):
                        waivered.add(mod)
            except (OSError, json.JSONDecodeError) as e:
                return _result(FAIL, 0.0, f"waiver file unreadable -- {e}")

        modules = _registry_modules()
        missing: list[str] = []
        stale: list[str] = []
        covered = 0
        for mod in sorted(modules):
            has_test = _has_test(specs_dir, mod)
            if has_test:
                covered += 1
                if mod in waivered:
                    stale.append(
                        f"{mod} -- waiver is stale; module now has a test spec, "
                        f"remove from {WAIVERS_REL}"
                    )
            else:
                if mod in waivered:
                    continue
                missing.append(
                    f"{mod} -- no test spec at {SPECS_REL}/{mod}.test.py "
                    "(add a test, or document the gap in the waiver registry)"
                )

        issues = missing + stale
        if not issues:
            if waivered:
                return _result(
                    WARN, max(0.0, 1.0 - len(waivered) / 30.0),
                    f"{covered} verifier module(s) have tests; "
                    f"{len(waivered)} waivered (technical debt)",
                )
            return _result(
                PASS, 1.0,
                f"{covered} verifier module(s) have tests; no waivers",
            )
        score = max(0.0, 1.0 - len(issues) / 10.0)
        status = FAIL
        summary = (
            f"{len(missing)} verifier module(s) lack tests"
            + (f", {len(stale)} stale waiver(s)" if stale else "")
        )
        return _result(status, score, summary, issues[:30])
