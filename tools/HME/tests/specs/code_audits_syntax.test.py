#!/usr/bin/env python3
"""Smoke + class-shape tests for verify_coherence.code_audits_syntax."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from helpers import assert_class_shape, smoke_run


def _classes():
    from verify_coherence.code_audits_syntax import (
        PythonSyntaxVerifier, ShellSyntaxVerifier,
        ShellUndefinedVarsVerifier, StalePathRenameVerifier,
    )
    return (PythonSyntaxVerifier, ShellSyntaxVerifier, ShellUndefinedVarsVerifier, StalePathRenameVerifier)


class CodeAuditsSyntaxModuleTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        smoke_run(self, _classes())


class ShellUndefinedGateTests(unittest.TestCase):
    """Undefined $VAR under set -u is silent-disable class: any count > 0 must
    FAIL, not get swallowed into a green 'tracked in backlog' verdict."""

    def _verifier(self):
        from verify_coherence.code_audits_syntax import ShellUndefinedVarsVerifier
        return ShellUndefinedVarsVerifier()

    def test_nonzero_fails(self):
        import json as _json
        import verify_coherence.code_audits_syntax as mod
        payload = _json.dumps({"violation_count": 2, "files_scanned": 9,
                               "files": [{"file": "h.sh", "findings": [{"line": 3, "var": "X", "snippet": "$X"}]}]})
        orig = mod._run_subprocess
        mod._run_subprocess = lambda *a, **k: (1, payload, "")
        try:
            r = self._verifier().run()
            self.assertEqual(r.status, "FAIL", r.summary)
        finally:
            mod._run_subprocess = orig

    def test_zero_passes(self):
        import json as _json
        import verify_coherence.code_audits_syntax as mod
        orig = mod._run_subprocess
        mod._run_subprocess = lambda *a, **k: (0, _json.dumps({"violation_count": 0, "files_scanned": 9, "files": []}), "")
        try:
            r = self._verifier().run()
            self.assertEqual(r.status, "PASS", r.summary)
        finally:
            mod._run_subprocess = orig


if __name__ == "__main__":
    unittest.main()
