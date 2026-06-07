"""Tests for HCI verifier purpose-contract wiring."""
from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))
os.environ.setdefault("PROJECT_ROOT", str(ROOT))
os.environ.setdefault("HME_METRICS_DIR", str(ROOT / "tools/HME/runtime/metrics"))
os.environ.setdefault("METRICS_DIR", str(ROOT / "src/output/metrics"))
os.environ.setdefault("HME_IGNORE_DIRS", "node_modules,.git,tmp,log,runtime")
os.environ.setdefault("HME_IGNORE_FILES", "package-lock.json,pnpm-lock.yaml")
os.environ.setdefault("HME_IGNORE_EXTS", ".log,.jsonl,.tmp")

from verify_coherence.verifier_purpose import REQUIRED_FIELDS, VerifierPurposeContractVerifier  # noqa: E402


class VerifierPurposeTests(unittest.TestCase):
    def test_purpose_contract_declares_required_fields(self):
        data = json.loads((ROOT / "tools/HME/config/verifier-purpose-contract.json").read_text(encoding="utf-8"))
        self.assertLessEqual(REQUIRED_FIELDS, set(data["required_fields"]))
        self.assertEqual(data["strict_mode_env"], "HME_VERIFIER_PURPOSE_STRICT")

    def test_verifier_purpose_contract_passes_or_warns_current_tree(self):
        r = VerifierPurposeContractVerifier().run()
        self.assertIn(r.status, {"PASS", "WARN"}, msg=f"summary={r.summary} details={r.details}")
        self.assertIn("verifier purpose contract", r.summary)


if __name__ == "__main__":
    unittest.main()
