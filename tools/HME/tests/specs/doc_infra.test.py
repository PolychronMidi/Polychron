"""Tests for doc/infra generated-doc maintenance."""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
UPDATE_SELF = ROOT / "doc/infra/update_self_coherence.py"
UPDATE_INDEX = ROOT / "doc/infra/update_full_indexes.py"
SELF_DOC = ROOT / "doc/self-coherence-full.md"


def _load(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


class DocInfraTests(unittest.TestCase):
    def test_update_full_indexes_remains_single_responsibility(self):
        text = UPDATE_INDEX.read_text(encoding="utf-8")
        self.assertIn("doc-infra-nav:start", text)
        self.assertNotIn("doc-infra-generated:start", text)
        self.assertNotIn("project_boundaries.json", text)

    def test_self_coherence_generated_block_matches_live_data(self):
        mod = _load(UPDATE_SELF)
        doc = SELF_DOC.read_text(encoding="utf-8")
        self.assertEqual(mod.update_text(doc, ROOT), doc)
        self.assertIn("<!-- doc-infra-generated:start -->", doc)
        self.assertIn("tools/HME/project_boundaries.json", doc)
        self.assertIn("teams/rounds/depth_policy.json", doc)
        self.assertIn("config/models.json", doc)

    def test_self_coherence_generator_check_mode_passes(self):
        r = subprocess.run([sys.executable, str(UPDATE_SELF), "--check"], cwd=ROOT, text=True, capture_output=True, timeout=30)
        self.assertEqual(r.returncode, 0, msg=r.stderr + r.stdout)


if __name__ == "__main__":
    unittest.main()
