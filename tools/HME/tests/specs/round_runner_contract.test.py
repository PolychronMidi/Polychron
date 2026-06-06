"""Contract tests for first-class team round runners (run with python3).

Phase 14 Workstream 1 makes observability a binding runner contract: no first-class
round may be a black box, silently reroute structured roles, or destroy canonical
team-channel / session history.
"""
from __future__ import annotations

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[4]
ROUND_RUNNERS = [ROOT / "teams/rounds/round_measured.sh"]
PROGRESS = ROOT / "teams/rounds/_progress.sh"


class RoundRunnerContractTests(unittest.TestCase):
    def test_progress_helper_emits_typed_result_fields(self):
        text = PROGRESS.read_text(encoding="utf-8")
        for needle in ("progress_result()", "PROG_TARGET", "PROG_RC", "PROG_REPLY_BYTES", "PROG_ERROR_LOG"):
            self.assertIn(needle, text)
        for field in ('"target"', '"rc"', '"reply_bytes"', '"error_log"'):
            self.assertIn(field, text)

    def test_first_class_runners_use_typed_progress_and_named_targets(self):
        for path in ROUND_RUNNERS:
            text = path.read_text(encoding="utf-8")
            with self.subTest(path=path.name):
                self.assertIn('source "$REPO/teams/rounds/_progress.sh"', text)
                self.assertIn("progress_init", text)
                self.assertIn("progress_result", text)
                self.assertIn("--target", text)
                self.assertIn("reply captured", text)
                self.assertIn("dispatch failed", text)
                self.assertIn("reply_bytes", text)

    def test_first_class_runners_clean_stale_outputs_without_destroying_channels_or_sessions(self):
        for path in ROUND_RUNNERS:
            text = path.read_text(encoding="utf-8")
            with self.subTest(path=path.name):
                self.assertIn('rm -f "$OUT"/', text, "runner must clear stale per-round outputs")
                self.assertNotIn('rm -f "$REPO"/teams/runtime/*.session', text)
                self.assertNotIn(" > \"$REPO/teams/$c.md\"", text)
                self.assertIn("Preserve canonical team channels/session files", text)


if __name__ == "__main__":
    unittest.main()
