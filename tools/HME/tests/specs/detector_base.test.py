"""Smoke test for the BehavioralDetector base class."""
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parent.parent.parent / "scripts" / "detectors"))

from _base import BehavioralDetector, emit_stats, load_turn, transcript_arg  # noqa: E402


class _AlwaysFires(BehavioralDetector):
    name = "always_fires"
    phases = ["stop", "pre_tool_use"]
    reason_text = "ALWAYS_FIRES detector test"

    def predicate(self, ctx):
        return True


class _NeverFires(BehavioralDetector):
    name = "never_fires"
    phases = ["stop", "pre_tool_use"]

    def predicate(self, ctx):
        return False


class BaseDetectorTests(unittest.TestCase):
    def _make_transcript(self):
        f = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
        f.write(json.dumps({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "hi"}]}}) + "\n")
        f.close()
        return f.name

    def _capture(self, fn):
        buf = io.StringIO()
        old = sys.stdout
        try:
            sys.stdout = buf
            fn()
        finally:
            sys.stdout = old
        return buf.getvalue()

    def test_stop_main_prints_name_when_fires(self):
        path = self._make_transcript()
        try:
            out = self._capture(lambda: _AlwaysFires().stop_main(path))
            self.assertIn("always_fires", out)
        finally:
            os.unlink(path)

    def test_stop_main_prints_ok_when_quiet(self):
        path = self._make_transcript()
        try:
            out = self._capture(lambda: _NeverFires().stop_main(path))
            self.assertEqual(out.strip(), "ok")
        finally:
            os.unlink(path)

    def test_bypass_env_silences_detector(self):
        path = self._make_transcript()
        os.environ["TEST_BYPASS"] = "1"
        try:
            d = _AlwaysFires()
            d.bypass_env = "TEST_BYPASS"
            out = self._capture(lambda: d.stop_main(path))
            self.assertEqual(out.strip(), "ok")
        finally:
            del os.environ["TEST_BYPASS"]
            os.unlink(path)

    def test_pre_tool_use_main_emits_deny_envelope(self):
        path = self._make_transcript()
        old_in = sys.stdin
        try:
            sys.stdin = io.StringIO(json.dumps({
                "transcript_path": path,
                "tool_name": "Bash",
                "tool_input": {"command": "ls"},
            }))
            out = self._capture(lambda: _AlwaysFires().pre_tool_use_main())
            data = json.loads(out)
            self.assertEqual(data["hookSpecificOutput"]["permissionDecision"], "deny")
            self.assertIn("ALWAYS_FIRES", data["hookSpecificOutput"]["permissionDecisionReason"])
        finally:
            sys.stdin = old_in
            os.unlink(path)

    def test_detector_runtime_emits_declared_name(self):
        with mock.patch("_detector_stats.emit_stats") as emit_stats:
            detector("sample_detector").emit("ok", "detail")
        emit_stats.assert_called_once_with("sample_detector", "ok", "detail")

    def test_detector_runtime_decorator_attaches_helpers(self):
        runtime = detector("decorated_detector")

        @runtime
        def main():
            return 0

        self.assertEqual(main.detector_name, "decorated_detector")
        with mock.patch("_detector_stats.emit_stats") as emit_stats:
            main.emit_stats("verdict", "detail")
        emit_stats.assert_called_once_with("decorated_detector", "verdict", "detail")

    def test_transcript_arg_and_load_turn_helpers(self):
        self.assertIsNone(transcript_arg(["detector.py"]))
        self.assertEqual(transcript_arg(["detector.py", "/tmp/t.jsonl"]), "/tmp/t.jsonl")
        self.assertIsNone(load_turn(lambda p: [p], ["detector.py"]))
        self.assertEqual(load_turn(lambda p: [p], ["detector.py", "/tmp/t.jsonl"]), ["/tmp/t.jsonl"])


if __name__ == "__main__":
    unittest.main()
