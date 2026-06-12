"""Tests for the round progress ledger reader (no shebang: run via `python3 ...`).

The round runners append a durable per-step record to the progress ledger so a
round is never flying blind and a mid-round death loses only the in-flight step.
These tests prove the reader parses a partial (incomplete) ledger and reports
in-progress vs complete -- the observability the infrastructure exists for.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "teams" / "rounds"))
os.environ.setdefault("PROJECT_ROOT", str(ROOT))

import round_status  # noqa: E402


def _ledger(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


class RoundStatusTests(unittest.TestCase):
    def test_reads_partial_ledger_without_losing_completed_steps(self):
        # A round that DIED mid-flight: 2 steps done, 1 still 'dispatching'. The
        # reader must surface every completed step (nothing thrown away).
        with tempfile.TemporaryDirectory() as td:
            led = Path(td) / "round-progress.jsonl"
            _ledger(led, [
                {"ts": "t0", "round": "r", "step": "round", "status": "start", "detail": "", "progress": "0/3"},
                {"ts": "t1", "round": "r", "step": "a", "status": "dispatching", "detail": "", "progress": "0/3"},
                {"ts": "t2", "round": "r", "step": "a", "status": "done", "detail": "reply_bytes=10", "progress": "1/3"},
                {"ts": "t3", "round": "r", "step": "b", "status": "dispatching", "detail": "", "progress": "1/3"},
            ])
            rows = round_status.read_ledger(led)
            self.assertEqual(len(rows), 4)
            done = [r for r in rows if r["status"] == "done"]
            self.assertEqual(len(done), 1)
            self.assertEqual(done[0]["step"], "a")
            # last step is an unfinished 'dispatching' -> NOT complete
            self.assertNotEqual(rows[-1]["status"], "done")

    def test_ignores_malformed_lines(self):
        with tempfile.TemporaryDirectory() as td:
            led = Path(td) / "p.jsonl"
            led.write_text('{"step":"a","status":"done"}\nNOT JSON\n\n{"step":"b","status":"done"}\n', encoding="utf-8")
            rows = round_status.read_ledger(led)
            self.assertEqual([r["step"] for r in rows], ["a", "b"])

    def test_missing_ledger_is_empty_not_an_error(self):
        rows = round_status.read_ledger(Path(tempfile.gettempdir()) / "definitely-absent-ledger.jsonl")
        self.assertEqual(rows, [])

    def test_typed_failure_state_surfaces_from_ledger(self):
        with tempfile.TemporaryDirectory() as td:
            led = Path(td) / "round-progress.jsonl"
            _ledger(led, [
                {"ts": "t0", "round": "r", "step": "round", "status": "start", "progress": "0/1"},
                {"ts": "t1", "round": "r", "step": "peer.json", "status": "dispatching", "target": "red_lead", "progress": "0/1"},
                {"ts": "t2", "round": "r", "step": "peer.json", "status": "failed", "target": "red_lead", "rc": 124, "reply_bytes": 0, "error_log": "teams/runtime/output/err", "progress": "1/1"},
            ])
            rows = round_status.read_ledger(led)
            failed = rows[-1]
            self.assertEqual(failed["status"], "failed")
            self.assertEqual(failed["target"], "red_lead")
            self.assertEqual(failed["rc"], 124)
            self.assertEqual(failed["reply_bytes"], 0)
            self.assertEqual(failed["error_log"], "teams/runtime/output/err")

    def test_failed_round_is_terminal_not_in_progress(self):
        # A round whose final record is round/failed is terminal (FAILED), and
        # must not be reported as still in-progress.
        import io
        import contextlib
        led = Path(round_status._LEDGER)
        led.parent.mkdir(parents=True, exist_ok=True)
        backup = led.read_text(encoding="utf-8") if led.exists() else None
        try:
            _ledger(led, [
                {"ts": "t0", "round": "r", "step": "round", "status": "start", "progress": "0/1"},
                {"ts": "t1", "round": "r", "step": "a", "status": "failed", "target": "red_lead", "rc": 1, "reply_bytes": 0, "progress": "1/1"},
                {"ts": "t2", "round": "r", "step": "round", "status": "failed", "detail": "1 step(s) failed", "progress": "1/1"},
            ])
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                round_status.main([])
            out = buf.getvalue()
            self.assertIn("state: FAILED", out)
            self.assertNotIn("in progress", out)
        finally:
            if backup is not None:
                led.write_text(backup, encoding="utf-8")
            elif led.exists():
                led.unlink()

    def test_depth_decision_rows_render_without_progress_fields(self):
        import io
        import contextlib
        led = Path(round_status._LEDGER)
        led.parent.mkdir(parents=True, exist_ok=True)
        backup = led.read_text(encoding="utf-8") if led.exists() else None
        try:
            _ledger(led, [
                {"ts": "t0", "round": "r", "step": "round", "status": "start", "progress": "0/1"},
                {"event": "mesh_depth_decision", "round": "r", "current_depth": 2, "next_depth": 3, "decision": "escalate_to_cross_exam", "depth_pressure": 1.25, "evidence_gates": ["contradiction"], "anti_bloat_check": "new evidence required next turn"},
            ])
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                round_status.main([])
            out = buf.getvalue()
            self.assertIn("mesh_depth_decision 2->3", out)
            self.assertIn("pressure=1.25", out)
            self.assertIn("gates=contradiction", out)
        finally:
            if backup is not None:
                led.write_text(backup, encoding="utf-8")
            elif led.exists():
                led.unlink()

    def test_main_smoke_returns_zero(self):
        # The reader itself must never crash (it is the flying-blind guard).
        self.assertEqual(round_status.main([]), 0)


if __name__ == "__main__":
    unittest.main()
