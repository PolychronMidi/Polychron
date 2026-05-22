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


if __name__ == "__main__":
    unittest.main()
