#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
DETECTOR = ROOT / "tools/HME/scripts/detectors/task_notification_truth_gate.py"


def user(text: str) -> dict:
    return {"type": "user", "message": {"role": "user", "content": text}}


def assistant(text: str) -> dict:
    return {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}


def note(task_id: str, status: str, summary: str) -> str:
    return f"""<task-notification>
<task-id>{task_id}</task-id>
<status>{status}</status>
<summary>{summary}</summary>
</task-notification>"""


def run_case(events: list[dict]) -> str:
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, dir=str(ROOT / "tmp")) as f:
        path = Path(f.name)
        for ev in events:
            f.write(json.dumps(ev) + "\n")
    try:
        out = subprocess.run([sys.executable, str(DETECTOR), str(path)], capture_output=True, text=True, timeout=10)
        return (out.stdout or "").strip().splitlines()[-1]
    finally:
        try:
            path.unlink()
        except OSError:
            pass  # silent-ok: pending review


class TaskNotificationTruthGateTests(unittest.TestCase):
    def test_completed_notification_blocks_still_waiting_reply(self):
        verdict = run_case([
            user(note("bzo1f4mfu", "completed", 'Background command "Run final JS" completed (exit code 0)')),
            assistant("Only strip notice arrived; still waiting for completion notification."),
        ])
        self.assertEqual(verdict, "task_notification_mishandled")

    def test_completed_notification_blocks_empty_stripped_reply(self):
        verdict = run_case([
            user(note("bzo1f4mfu", "completed", 'Background command "Run final JS" completed (exit code 0)')),
            assistant("No actionable content came through; stripped by HME boilerplate."),
        ])
        self.assertEqual(verdict, "task_notification_mishandled")

    def test_failed_notification_requires_failure_acknowledgement(self):
        verdict = run_case([
            user(note("bdiuswni8", "failed", 'Background command "Run full HME tests" failed with exit code 1')),
            assistant("No new request text made it through."),
        ])
        self.assertEqual(verdict, "task_notification_mishandled")

    def test_completed_notification_blocks_placeholder_request_reply(self):
        verdict = run_case([
            user(note("bfrh1cj9k", "completed", 'Background command "Run full JS HME suite" completed (exit code 0)')),
            assistant("Only see plachldr. Paste actl req/text want - do"),
        ])
        self.assertEqual(verdict, "task_notification_mishandled")

    def test_completed_notification_passes_when_answer_uses_status_facts(self):
        verdict = run_case([
            user(note("bzo1f4mfu", "completed", 'Background command "Run final JS" completed (exit code 0)')),
            assistant("Task bzo1f4mfu completed with exit code 0; final JS suite passed."),
        ])
        self.assertEqual(verdict, "ok")

    def test_failed_notification_passes_when_answer_uses_failure_facts(self):
        verdict = run_case([
            user(note("bdiuswni8", "failed", 'Background command "Run full HME tests" failed with exit code 1')),
            assistant("Task bdiuswni8 failed with exit code 1; isolating and fixing the failing Python spec next."),
        ])
        self.assertEqual(verdict, "ok")

    def test_detector_stats_expands_template_metrics_env(self):
        with tempfile.TemporaryDirectory(dir=str(ROOT / "tmp")) as td:
            code = (
                "import sys;"
                f"sys.path.insert(0, {str(ROOT / 'tools/HME/scripts/detectors')!r});"
                "from _detector_stats import emit_stats;"
                "emit_stats('task_notification_truth_gate', 'ok', 'env_path_test')"
            )
            env = {
                **os.environ,
                "PROJECT_ROOT": td,
                "HME_RUNTIME_DIR": "${PROJECT_ROOT}/tools/HME/runtime",
                "HME_METRICS_DIR": "${HME_RUNTIME_DIR}/metrics",
            }
            out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=10, env=env)
            self.assertEqual(out.returncode, 0, msg=out.stderr or out.stdout)
            self.assertTrue(Path(td, "tools/HME/runtime/metrics/detector-stats.jsonl").exists())
            self.assertFalse(Path(td, "${HME_RUNTIME_DIR}").exists())


if __name__ == "__main__":
    os.environ.setdefault("PROJECT_ROOT", str(ROOT))
    unittest.main()
