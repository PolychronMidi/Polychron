"""HCI-integrity regression tests (run via the HME test runner, which loads .env).

Phase 14 Workstream 3 (mesh-found, 4-peer unanimous): the published HME Coherence
Index must never be MISLEADING or fail-OPEN. These cover the exact failure modes the
mesh round surfaced against the HCI machinery -- each builds a tiny fake registry /
verdict so a genuine defect would be caught, per the cross-exam's explicit demand.
"""
from __future__ import annotations

from pathlib import Path as _Path  # noqa: E402
import sys as _sys  # noqa: E402
_sys.path.insert(0, str(_Path(__file__).resolve().parents[1] / "_lib"))
import specenv  # noqa: E402,F401  -- env parity for bare `python3 <spec>.test.py`

import math
import sys
import types
import unittest
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(_SCRIPTS))

from verify_coherence import __main__ as engine  # noqa: E402
from verify_coherence._base import (  # noqa: E402
    ERROR, FAIL, PASS, SKIP, WARN, VerdictResult, _normalize_verdict,
)


def _fake(name, weight=1.0):
    return types.SimpleNamespace(name=name, weight=weight)


class _StaticFakeVerifier:
    name = "fake-static"
    category = "code"
    subtag = "unit"
    weight = 1.0

    def execute(self):
        return VerdictResult(PASS, 1.0, "ok", [])


class EngineReportShapeTests(unittest.TestCase):
    def test_verifier_entries_include_their_own_name(self):
        old = engine.REGISTRY
        try:
            engine.REGISTRY = [_StaticFakeVerifier()]
            report = engine.run_engine()
        finally:
            engine.REGISTRY = old
        self.assertEqual(report["verifiers"]["fake-static"]["name"], "fake-static")


class PreflightRegistryTests(unittest.TestCase):
    def test_duplicate_names_fail_closed(self):
        reg = [_fake("a"), _fake("b"), _fake("a")]
        with self.assertRaises(ValueError) as cm:
            engine._preflight_registry(reg)
        self.assertIn("duplicate verifier name", str(cm.exception))

    def test_zero_negative_and_nonfinite_weights_fail_closed(self):
        for bad in (0, -1.0, float("nan"), float("inf"), "x", True):
            with self.subTest(weight=bad):
                with self.assertRaises(ValueError) as cm:
                    engine._preflight_registry([_fake("solo", weight=bad)])
                self.assertIn("invalid weight", str(cm.exception))

    def test_clean_registry_passes_preflight(self):
        # No exception for unique names + finite positive weights.
        engine._preflight_registry([_fake("a", 1.0), _fake("b", 0.5)])


class NormalizeVerdictTests(unittest.TestCase):
    def test_fail_cannot_read_as_perfect_score(self):
        r = _normalize_verdict(VerdictResult(FAIL, 1.0, "broken", []))
        self.assertEqual(r.status, FAIL)
        self.assertLess(r.score, 1.0)

    def test_unknown_status_becomes_error_zero(self):
        r = _normalize_verdict(VerdictResult("GREENISH", 1.0, "bogus", []))
        self.assertEqual(r.status, ERROR)
        self.assertEqual(r.score, 0.0)

    def test_error_forced_to_zero(self):
        r = _normalize_verdict(VerdictResult(ERROR, 0.9, "broke", []))
        self.assertEqual(r.score, 0.0)

    def test_skip_pinned_to_one(self):
        r = _normalize_verdict(VerdictResult(SKIP, 0.0, "opt out", []))
        self.assertEqual(r.score, 1.0)

    def test_well_formed_pass_and_warn_unchanged(self):
        p = _normalize_verdict(VerdictResult(PASS, 1.0, "ok", []))
        self.assertEqual((p.status, p.score), (PASS, 1.0))
        w = _normalize_verdict(VerdictResult(WARN, 0.6, "meh", []))
        self.assertEqual((w.status, w.score), (WARN, 0.6))


if __name__ == "__main__":
    unittest.main()
