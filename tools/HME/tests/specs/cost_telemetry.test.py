"""Tests for D2: cost telemetry + adaptive-effort advisory (no shebang)."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "teams" / "rounds"))

import cost_telemetry  # noqa: E402


class CostTelemetryTests(unittest.TestCase):
    def test_record_and_report_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            tel = Path(td) / "tel.jsonl"
            card = {
                "baseline": {"reply_bytes": 1000, "findings": 4},
                "mesh": {"reply_bytes": 6000, "findings": 12, "arms": 3},
                "unique_in_mesh": 5,
            }
            row = cost_telemetry.record(card, "state_registry.js", duration_sec=42.0, telemetry_path=tel)
            self.assertEqual(row["target"], "state_registry.js")
            self.assertEqual(row["mesh_cost_per_finding"], 500.0)  # 6000/12
            self.assertEqual(row["unique_in_mesh"], 5)
            cost_telemetry.record(card, "stop_chain.js", duration_sec=50.0, telemetry_path=tel)
            rep = cost_telemetry.report(tel)
            self.assertEqual(rep["rounds"], 2)
            self.assertEqual(rep["total_unique_in_mesh"], 10)
            self.assertIn("state_registry.js", rep["targets"])

    def test_advise_effort_is_a_floor_not_a_cap(self):
        small = cost_telemetry.advise_effort(1000)
        big = cost_telemetry.advise_effort(80_000)
        # Bigger surfaces get a HIGHER minimum -- never a lower ceiling.
        self.assertTrue(small["is_floor_not_cap"])
        self.assertTrue(big["is_floor_not_cap"])
        self.assertGreaterEqual(big["leash_floor_sec"], small["leash_floor_sec"])
        self.assertEqual(big["min_effort"], "max")
        # The charter guarantee is explicit in the payload.
        self.assertIn("never cap", big["headroom"])

    def test_record_handles_missing_telemetry_dir_gracefully(self):
        with tempfile.TemporaryDirectory() as td:
            tel = Path(td) / "nested" / "deep" / "tel.jsonl"
            row = cost_telemetry.record({"mesh": {}, "baseline": {}}, "x", telemetry_path=tel)
            self.assertEqual(row["target"], "x")
            self.assertTrue(tel.is_file())
            line = json.loads(tel.read_text(encoding="utf-8").strip())
            self.assertEqual(line["target"], "x")


if __name__ == "__main__":
    unittest.main()
