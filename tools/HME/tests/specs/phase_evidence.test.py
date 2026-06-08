"""Tests for phase evidence proof references."""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
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

from verify_coherence.phase_evidence import (  # noqa: E402
    ALLOWED_ROW_FIELDS,
    FOGGY_CLOSES,
    PhaseEvidenceVerifier,
)


class PhaseEvidenceTests(unittest.TestCase):
    def test_phase_evidence_shape_is_adapter_not_second_ledger(self):
        data = json.loads((ROOT / "tools/HME/config/phase-evidence.json").read_text(encoding="utf-8"))
        forbidden = set(data["forbidden_fields"])
        self.assertFalse(forbidden & ALLOWED_ROW_FIELDS)
        self.assertFalse(set(data["closes_enum"]) & FOGGY_CLOSES)
        self.assertIn("planned_vs_executed", data["closes_enum"])
        self.assertIn("future_phase_done", data["does_not_prove_enum"])
        rows = {row["phase"]: row for row in data["phases"]}
        self.assertLessEqual({15, 16}, set(rows))
        self.assertEqual(data["enforce_done_from_phase"], 15)
        for row in rows.values():
            self.assertEqual(set(row), ALLOWED_ROW_FIELDS)
            self.assertIn("future_phase_done", row["does_not_prove"])
        self.assertIn("phase-evidence", rows[16]["hci"])

    def test_phase_evidence_verifier_passes_current_tree(self):
        r = PhaseEvidenceVerifier().run()
        self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")
        self.assertIn("phase evidence valid", r.summary)


if __name__ == "__main__":
    unittest.main()
