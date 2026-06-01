#!/usr/bin/env python3
"""Smoke + class-shape tests for verify_coherence.code_audits_test."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from helpers import assert_class_shape, smoke_run


def _classes():
    from verify_coherence.code_audits_test import (
        SilentFailureClassVerifier, TestIsolationVerifier,
        TestEnvUndefinedVerifier,
    )
    return (SilentFailureClassVerifier, TestIsolationVerifier, TestEnvUndefinedVerifier)


class CodeAuditsTestModuleTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        smoke_run(self, _classes())


class SilentFailureGateTests(unittest.TestCase):
    """The silent-failure verifier must FAIL on a nonzero count (no advisory
    swallow) and PASS only at zero -- proving the gate the phantom 'logarithmic
    scaling' comment used to wave through can actually fail."""

    def _verifier(self):
        from verify_coherence.code_audits_test import SilentFailureClassVerifier
        return SilentFailureClassVerifier()

    def test_nonzero_count_fails(self):
        import verify_coherence.code_audits_test as mod
        orig = mod._run_subprocess
        mod._run_subprocess = lambda *a, **k: (1, "7 unmarked silent-catch sites across 3 files\nx.py:1: foo", "")
        try:
            r = self._verifier().run()
            self.assertEqual(r.status, "FAIL", r.summary)
            self.assertIn("7 unmarked", r.summary)
        finally:
            mod._run_subprocess = orig

    def test_zero_count_passes(self):
        import verify_coherence.code_audits_test as mod
        orig = mod._run_subprocess
        mod._run_subprocess = lambda *a, **k: (0, "no unmarked silent-catch sites found", "")
        try:
            r = self._verifier().run()
            self.assertEqual(r.status, "PASS", r.summary)
        finally:
            mod._run_subprocess = orig


if __name__ == "__main__":
    unittest.main()
