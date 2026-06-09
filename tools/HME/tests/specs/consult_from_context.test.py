from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "teams" / "rounds"))

import consult_from_context  # noqa: E402


class ConsultFromContextTests(unittest.TestCase):
    def test_hypermeta_manifest_loads_from_context(self):
        data = consult_from_context.load_manifest(ROOT / "teams/runtime/hypermeta-visions-consult-ctx.md")
        self.assertEqual(data["round"], "hypermeta-visions-consult")
        self.assertEqual(data["final_outputs"], ["red_final.json", "blue_final.json"])
        self.assertEqual(len(data["steps"]), 8)
        self.assertIn("{reply:cross_red.json}", data["steps"][-1]["message"])

    def test_completion_file_requires_final_outputs(self):
        manifest = {
            "round": "unit-consult",
            "final_outputs": ["final.json"],
            "steps": [{"id": "final.json"}],
        }
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            (out / "final.json").write_text(json.dumps({"reply": "ok"}), encoding="utf-8")
            ctx = out / "ctx.md"
            ctx.write_text("# ctx\n", encoding="utf-8")
            consult_from_context.write_completion(manifest, ctx, out, True)
            data = json.loads((out / "_consult-complete.json").read_text(encoding="utf-8"))
        self.assertTrue(data["complete"])
        self.assertEqual(data["must_read_before_report"], [str(out / "final.json")])
        self.assertIn("Do not report", data["premature_report_guard"])
        self.assertIn("Do not poll", data["polling_guard"])

    def test_native_read_queue_marker_has_stable_nonce_and_long_ttl(self):
        manifest = {
            "round": "unit-consult-queue",
            "final_outputs": ["final.json"],
            "steps": [{"id": "final.json"}],
        }
        latest = ROOT / "tools/HME/runtime/latest-consult-read-queue.json"
        old_latest = latest.read_text(encoding="utf-8") if latest.exists() else None
        try:
            with tempfile.TemporaryDirectory() as td:
                out = Path(td)
                (out / "final.json").write_text(json.dumps({"reply": "ok"}), encoding="utf-8")
                consult_from_context.write_completion(manifest, out / "ctx.md", out, True)
                consult_from_context.write_native_read_queue(manifest, out)
                marker = json.loads(latest.read_text(encoding="utf-8"))
            self.assertEqual(marker["round"], "unit-consult-queue")
            self.assertIn("nonce", marker)
            self.assertIn("unit-consult-queue", marker["nonce"])
            self.assertGreaterEqual(
                __import__("datetime").datetime.fromisoformat(marker["expires_at"].replace("Z", "+00:00")).timestamp()
                - __import__("datetime").datetime.fromisoformat(marker["generated_at"].replace("Z", "+00:00")).timestamp(),
                3500,
            )
        finally:
            if old_latest is None:
                try:
                    latest.unlink()
                except FileNotFoundError:
                    pass  # silent-ok: pending review
            else:
                latest.write_text(old_latest, encoding="utf-8")

    def test_runtime_consult_scripts_are_thin_wrappers(self):
        for script in (ROOT / "teams/runtime").glob("*consult.sh"):
            text = script.read_text(encoding="utf-8")
            with self.subTest(script=script.name):
                self.assertLessEqual(len(text.splitlines()), 4)
                self.assertIn("consult_from_context.py", text)
                self.assertNotIn("team_dispatch_guard.py", text)
                self.assertNotIn("progress_result", text)


if __name__ == "__main__":
    unittest.main()
