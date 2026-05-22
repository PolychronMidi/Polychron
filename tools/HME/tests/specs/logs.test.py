#!/usr/bin/env python3
"""Smoke + class-shape tests for verify_coherence.logs."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[0]))
from _verifier_smoke import assert_class_shape, smoke_run


def _classes():
    from verify_coherence.logs import (
        LogSizeVerifier, ErrorLogVerifier, LifesaverRateVerifier,
        PipelineBgScriptHealthVerifier,
    )
    return (LogSizeVerifier, ErrorLogVerifier, LifesaverRateVerifier,
            PipelineBgScriptHealthVerifier)


class LogsModuleTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            smoke_run(self, tmp, _classes())


if __name__ == "__main__":
    unittest.main()
