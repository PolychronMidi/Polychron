#!/usr/bin/env python3
"""Tests for optional HostCliSmokeVerifier gate."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tools" / "HME" / "scripts"))
os.environ.setdefault("PROJECT_ROOT", str(REPO_ROOT))
os.environ.setdefault("HME_METRICS_DIR", str(REPO_ROOT / "tools/HME/runtime/metrics"))
os.environ.setdefault("METRICS_DIR", str(REPO_ROOT / "src/output/metrics"))


class HostCliSmokeVerifierTests(unittest.TestCase):
    def test_skips_unless_enabled(self):
        prior = os.environ.pop("HME_RUN_CLI_SMOKE", None)
        try:
            from verify_coherence.host_cli_smoke import HostCliSmokeVerifier
            verdict = HostCliSmokeVerifier().run()
            self.assertEqual(verdict.status, "SKIP")
            self.assertIn("HME_RUN_CLI_SMOKE=1", verdict.summary)
        finally:
            if prior is not None:
                os.environ["HME_RUN_CLI_SMOKE"] = prior


if __name__ == "__main__":
    unittest.main(verbosity=2)
