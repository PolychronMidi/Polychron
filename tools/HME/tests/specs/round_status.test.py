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

    def test_main_runs_on_missing_ledger(self):
        # main() must never crash even with no ledger (flying-blind guard itself).
        with tempfile.TemporaryDirectory() as td:
            prior = os.environ.get("HME_ROUND_PROGRESS_FILE")
            os.environ["HME_ROUND_PROGRESS_FILE"] = str(Path(td) / "none.jsonl")
            try:
                self.assertEqual(round_status.main([]), 0)
            finally:
                if prior is None:
                    os.environ.pop("HME_ROUND_PROGRESS_FILE", None)
                else:
                    os.environ["HME_ROUND_PROGRESS_FILE"] = prior


if __name__ == "__main__":
    unittest.main()
