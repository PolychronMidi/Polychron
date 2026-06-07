"""Tests for the mesh-depth verifier contract."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))
os.environ.setdefault("PROJECT_ROOT", str(ROOT))
os.environ.setdefault("HME_METRICS_DIR", str(ROOT / "tools/HME/runtime/metrics"))
os.environ.setdefault("METRICS_DIR", str(ROOT / "src/output/metrics"))

from verify_coherence.mesh_depth import MeshDepthDecisionContractVerifier  # noqa: E402


class MeshDepthVerifierTests(unittest.TestCase):
    def test_mesh_depth_contract_verifier_passes_current_tree(self):
        r = MeshDepthDecisionContractVerifier().run()
        self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")
        self.assertIn("runner", r.summary)


if __name__ == "__main__":
    unittest.main()
