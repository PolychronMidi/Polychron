"""Tests for plan/TODO consistency verifier."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))
os.environ.setdefault("PROJECT_ROOT", str(ROOT))
os.environ.setdefault("HME_METRICS_DIR", str(ROOT / "tools/HME/runtime/metrics"))
os.environ.setdefault("METRICS_DIR", str(ROOT / "src/output/metrics"))
os.environ.setdefault("HME_IGNORE_DIRS", "node_modules,.git,tmp,log,runtime")
os.environ.setdefault("HME_IGNORE_FILES", "package-lock.json,pnpm-lock.yaml")
os.environ.setdefault("HME_IGNORE_EXTS", ".log,.jsonl,.tmp")

from verify_coherence.plan_todo_consistency import PlanTodoConsistencyVerifier, VALID_STATUSES  # noqa: E402


class PlanTodoConsistencyTests(unittest.TestCase):
    def test_valid_statuses_match_plan_legend(self):
        self.assertLessEqual({"proposed", "approved", "denied", "done"}, VALID_STATUSES)
        plan = (ROOT / "plan.md").read_text(encoding="utf-8")
        self.assertIn("- done: implemented + verified", plan)

    def test_plan_todo_consistency_passes_current_tree(self):
        r = PlanTodoConsistencyVerifier().run()
        self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")
        self.assertIn("consistent", r.summary)


if __name__ == "__main__":
    unittest.main()
