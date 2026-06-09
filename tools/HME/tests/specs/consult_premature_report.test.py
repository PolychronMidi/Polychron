from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "tools/HME/scripts/detectors"))

import consult_premature_report  # noqa: E402


class ConsultPrematureReportTests(unittest.TestCase):
    def test_report_shape_and_round_detection(self):
        text = "Mesh heard hypermeta-visions-consult and final synthesis converged."
        self.assertEqual(consult_premature_report._reported_round(text), "hypermeta-visions-consult")
        self.assertRegex(text, consult_premature_report.CONSULT_WORD_RE)
        self.assertRegex(text, consult_premature_report.REPORT_WORD_RE)

    def test_path_read_matches_repo_relative_suffix(self):
        required = "teams/runtime/output/x/red_final.json"
        reads = {str(ROOT / required)}
        self.assertTrue(consult_premature_report._path_read(required, reads))


if __name__ == "__main__":
    unittest.main()
