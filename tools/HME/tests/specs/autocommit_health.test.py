#!/usr/bin/env python3
"""Behavioural + smoke tests for verify_coherence.autocommit_health."""
from __future__ import annotations

import datetime
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from helpers import (
    assert_class_shape, smoke_run, with_project_root, init_git_repo,
)


def _classes():
    from verify_coherence.autocommit_health import (
        AutocommitHealthVerifier, ShimHealthVerifier,
    )
    return (AutocommitHealthVerifier, ShimHealthVerifier)


def _state_path(root: Path, name: str) -> Path:
    p = root / "tools" / "HME" / "runtime" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _fresh_heartbeat(root: Path) -> None:
    _state_path(root, "heartbeat-autocommit.ts").write_text(str(time.time()))


def _run_autocommit():
    from verify_coherence.autocommit_health import AutocommitHealthVerifier
    return AutocommitHealthVerifier().run()


class AutocommitHealthSmokeTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        smoke_run(self, _classes())


class AutocommitHealthBehaviourTests(unittest.TestCase):
    def test_pass_on_clean_worktree_with_fresh_heartbeat(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_git_repo(root)
            _fresh_heartbeat(root)
            r = with_project_root(root, _run_autocommit)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")

    def test_fail_when_sticky_fail_flag_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_git_repo(root)
            _fresh_heartbeat(root)
            _state_path(root, "autocommit.fail").write_text("commit hook bounced")
            r = with_project_root(root, _run_autocommit)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("fail flag set" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_fail_when_attempt_counter_at_three_or_more(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_git_repo(root)
            _fresh_heartbeat(root)
            _state_path(root, "autocommit.counter").write_text("5")
            r = with_project_root(root, _run_autocommit)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("counter at 5" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_fail_on_stale_last_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_git_repo(root)
            _fresh_heartbeat(root)
            stale = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=72)
            _state_path(root, "autocommit.last-success").write_text(stale.isoformat())
            r = with_project_root(root, _run_autocommit)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("h ago (>48h)" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_fail_when_dirty_worktree_with_missing_heartbeat(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_git_repo(root)
            (root / "dirt.txt").write_text("uncommitted\n")
            r = with_project_root(root, _run_autocommit)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("heartbeat missing" in d for d in r.details),
                            msg=f"details={r.details}")


if __name__ == "__main__":
    unittest.main()
