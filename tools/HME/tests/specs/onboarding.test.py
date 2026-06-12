#!/usr/bin/env python3
"""Smoke + class-shape tests for verify_coherence.onboarding."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from helpers import assert_class_shape, smoke_run


def _classes():
    from verify_coherence.onboarding import (
        StatesSyncVerifier, OnboardingFlowVerifier,
        OnboardingStateIntegrityVerifier, OnboardingChainImportVerifier,
    )
    return (StatesSyncVerifier, OnboardingFlowVerifier, OnboardingStateIntegrityVerifier, OnboardingChainImportVerifier)


class OnboardingModuleTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        smoke_run(self, _classes())


class OnboardingFlowRegressionTests(unittest.TestCase):
    """Regression guard for the bulk-migration shadow class.

    OnboardingFlowVerifier.run() used local variables named `passed`
    and `failed` as PASS/FAIL counters, which shadowed the result
    helpers of the same name after the migration. `return passed(...)`
    then tried to call an int and crashed. This test exercises run()
    directly so any future regression of that class -- a local name
    shadowing a helper -- surfaces as a TypeError instead of being
    wrapped into an ERROR verdict by execute().
    """

    def test_run_returns_verdict_result_not_typeerror(self):
        from verify_coherence._base import VerdictResult
        from verify_coherence.onboarding import OnboardingFlowVerifier
        r = OnboardingFlowVerifier().run()
        self.assertIsInstance(r, VerdictResult,
                              msg=f"OnboardingFlowVerifier.run returned {type(r)}")
        self.assertIn(r.status, ("PASS", "WARN", "FAIL", "SKIP"),
                      msg=f"unexpected status {r.status!r}")


if __name__ == "__main__":
    unittest.main()
