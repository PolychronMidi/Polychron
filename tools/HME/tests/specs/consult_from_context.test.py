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

    def test_collect_native_read_rows_requires_real_read_results(self):
        with tempfile.TemporaryDirectory() as td:
            trans = Path(td) / "session.jsonl"
            required = str(Path(td) / "final.json")
            rows = [
                {"type": "assistant", "timestamp": "2026-06-09T00:00:01Z", "message": {"content": [
                    {"type": "tool_use", "id": "call_real", "name": "Read", "input": {"file_path": required}},
                    {"type": "tool_use", "id": "hme_consult_auto_read_round_nonce_0", "name": "Read", "input": {"file_path": required}},
                ]}},
                {"type": "user", "timestamp": "2026-06-09T00:00:02Z", "message": {"content": [
                    {"type": "tool_result", "tool_use_id": "call_real", "content": "1\\t{}"},
                    {"type": "tool_result", "tool_use_id": "hme_consult_auto_read_round_nonce_0", "content": "synthetic"},
                ]}},
            ]
            trans.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
            read_rows, rejected = consult_from_context.collect_native_read_rows(trans, [required])
        self.assertEqual(len(read_rows), 1)
        self.assertEqual(read_rows[0]["tool_use_id"], "call_real")
        self.assertGreater(read_rows[0]["result_line"], 0)
        self.assertEqual(rejected[0]["reason"], "proxy-synthetic-auto-read-id")

    def test_prove_native_reads_fails_without_transcript(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            manifest = {"round": "unit-proof-fail"}
            old_env = {k: os.environ.get(k) for k in ("HME_TRANSCRIPT_PATH", "CLAUDE_PROJECT_DIR", "HME_CONSULT_NATIVE_READ_PROOF_DRIVER")}
            try:
                os.environ["HME_TRANSCRIPT_PATH"] = str(out / "missing.jsonl")
                os.environ["CLAUDE_PROJECT_DIR"] = str(out / "no-projects")
                os.environ["HME_CONSULT_NATIVE_READ_PROOF_DRIVER"] = "off"
                ok = consult_from_context.prove_native_reads(manifest, out, ["final.json"])
            finally:
                for k, v in old_env.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v
            proof = json.loads((out / "_consult-native-read-proof.json").read_text(encoding="utf-8"))
        self.assertFalse(ok)
        self.assertFalse(proof["verified"])
        self.assertIn("no Claude transcript", proof["failure"])

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
