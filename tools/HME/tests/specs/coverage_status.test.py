"""Tests for F1 auditability layer: coverage_status (no shebang)."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "teams" / "rounds"))

import coverage_status  # noqa: E402

_SAMPLE = json.dumps({"sections": [
    {"section": "Policy-enforcement surfaces", "surfaces": [
        {"surface": "pre-write gate", "file": "a.js", "status": "reviewed"},
        {"surface": "stop-chain", "file": "b.js", "status": "pending"},
    ]},
    {"section": "State-mutation surfaces", "surfaces": [
        {"surface": "state registry", "file": "c.js", "status": "reviewed"},
        {"surface": "tool-result", "file": "d.js", "status": "reviewed", "detail": "clean audit"},
    ]},
]})


class CoverageStatusTests(unittest.TestCase):
    def test_parses_sections_status_and_detail(self):
        with tempfile.TemporaryDirectory() as td:
            m = Path(td) / "map.json"
            m.write_text(_SAMPLE, encoding="utf-8")
            rows = coverage_status.parse_map(m)
            self.assertEqual(len(rows), 4)
            by = {r["surface"]: r for r in rows}
            self.assertEqual(by["tool-result"]["status"], "reviewed")  # detail kept separate from status
            self.assertEqual(by["stop-chain"]["status"], "pending")
            self.assertEqual(by["pre-write gate"]["section"], "Policy-enforcement surfaces")

    def test_status_report_counts_and_pending(self):
        with tempfile.TemporaryDirectory() as td:
            m = Path(td) / "map.json"
            m.write_text(_SAMPLE, encoding="utf-8")
            # point the module at the sample via the function arg
            rep = coverage_status.status_report(m)
            self.assertEqual(rep["total"], 4)
            self.assertEqual(rep["reviewed"], 3)
            self.assertEqual(rep["pending"], 1)
            self.assertEqual(rep["pending_surfaces"][0]["surface"], "stop-chain")

    def test_live_map_parses(self):
        rep = coverage_status.status_report()
        self.assertGreater(rep["total"], 0)
        # The live map should be well-formed (reviewed + pending + other == total).
        self.assertEqual(rep["reviewed"] + rep["pending"] + rep["other"], rep["total"])


if __name__ == "__main__":
    unittest.main()
