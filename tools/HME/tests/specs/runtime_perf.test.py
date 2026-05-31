#!/usr/bin/env python3
"""Smoke + class-shape tests for verify_coherence.runtime_perf."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))
from _env_loader import load_env
load_env(str(ROOT / ".env"))
os.environ.setdefault("PROJECT_ROOT", str(ROOT))
os.environ.setdefault("HME_METRICS_DIR", str(ROOT / "metrics"))
os.environ.setdefault("METRICS_DIR", str(ROOT / "metrics"))

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from helpers import assert_class_shape, smoke_run, with_project_root


def _classes():
    from verify_coherence.runtime_perf import (
        HookLatencyVerifier, GitCommitTestCoverageVerifier,
        ToolResponseLatencyVerifier,
    )
    return (HookLatencyVerifier, GitCommitTestCoverageVerifier, ToolResponseLatencyVerifier)


class RuntimePerfModuleTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        smoke_run(self, _classes())


if __name__ == "__main__":
    unittest.main()
