"""Tests for project boundary map and verifier."""
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

from verify_coherence.project_boundaries import ProjectBoundariesVerifier, REQUIRED_SUBSYSTEMS  # noqa: E402


class ProjectBoundariesTests(unittest.TestCase):
    def test_boundary_map_has_required_rows_and_non_ownership(self):
        data = json.loads((ROOT / "tools/HME/project_boundaries.json").read_text(encoding="utf-8"))
        self.assertLessEqual(REQUIRED_SUBSYSTEMS, set(data["subsystems"]))
        for name in REQUIRED_SUBSYSTEMS:
            row = data["subsystems"][name]
            self.assertTrue(row["owns"], name)
            self.assertTrue(row["does_not_own"], name)
            self.assertIn(row["path_class"], {"hot", "cold", "state", "policy"})
        self.assertEqual(data["canonical_destinations"]["work_state"], "doc/templates/TODO.md")
        self.assertEqual(data["canonical_destinations"]["phase_intent"], "plan.md")
        self.assertEqual(data["canonical_destinations"]["product_behavior"], "src/")
        self.assertIn("tools/HME/scripts/verify_coherence/", data["hot_path_forbidden_import_prefixes"])
        self.assertIn("verify-coherence.py", data["hot_path_forbidden_markers"])

    def test_project_boundaries_verifier_passes_current_tree(self):
        r = ProjectBoundariesVerifier().run()
        self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")
        self.assertIn("project boundary map valid", r.summary)


if __name__ == "__main__":
    unittest.main()
