"""Tests for optional HostCliSmokeVerifier gate."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[4]
# Load root .env so importing verify_coherence does not explode on required
# HME_* keys when this unit test is run directly.
for line in (REPO_ROOT / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    os.environ.setdefault(k.strip(), v.split("#", 1)[0].strip())
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
