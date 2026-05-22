#!/usr/bin/env python3
"""Unit tests for the hook-command-existence verifier.

Run: python3 tools/HME/tests/specs/hook_existence.test.py
"""
from __future__ import annotations

import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tools" / "HME" / "scripts"))


def _purge():
    for mod in list(sys.modules.keys()):
        if mod == "verify_coherence" or mod.startswith("verify_coherence."):
            sys.modules.pop(mod, None)


def _with_settings(tmp: Path, settings: dict | None, fn):
    settings_path = tmp / "settings.json"
    if settings is not None:
        settings_path.write_text(json.dumps(settings))
    prior = os.environ.get("PROJECT_ROOT")
    prior_metrics = os.environ.get("HME_METRICS_DIR")
    os.environ["PROJECT_ROOT"] = str(tmp)
    os.environ["HME_METRICS_DIR"] = str(tmp / "metrics")
    _purge()
    try:
        with mock.patch("os.path.expanduser", side_effect=lambda p:
                        str(settings_path) if p == "~/.claude/settings.json" else os.path.expanduser(p)):
            return fn()
    finally:
        if prior is None:
            del os.environ["PROJECT_ROOT"]
        else:
            os.environ["PROJECT_ROOT"] = prior
        if prior_metrics is None:
            del os.environ["HME_METRICS_DIR"]
        else:
            os.environ["HME_METRICS_DIR"] = prior_metrics
        _purge()


def _run():
    from verify_coherence.hook_existence import HookCommandExistenceVerifier
    return HookCommandExistenceVerifier().run()


def _make_executable(path: Path) -> None:
    path.touch()
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


class HookCommandExistenceTests(unittest.TestCase):
    def test_skip_when_settings_file_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = _with_settings(Path(tmp), None, _run)
            self.assertEqual(r.status, "SKIP")

    def test_skip_when_hooks_key_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = _with_settings(Path(tmp), {"other": "value"}, _run)
            self.assertEqual(r.status, "SKIP")

    def test_skip_when_no_path_tokens_in_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = _with_settings(Path(tmp), {
                "hooks": {"PreToolUse": [{"hooks": [{"command": "echo hi"}]}]},
            }, _run)
            self.assertEqual(r.status, "SKIP", msg=f"summary={r.summary}")

    def test_pass_when_all_paths_resolve(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / "real-hook.sh"
            _make_executable(script)
            r = _with_settings(root, {
                "hooks": {"Stop": [{"hooks": [{"command": f"bash {script}"}]}]},
            }, _run)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")

    def test_fail_on_missing_absolute_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            missing = root / "ghost.sh"
            r = _with_settings(root, {
                "hooks": {"Stop": [{"hooks": [{"command": f"bash {missing}"}]}]},
            }, _run)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("ghost.sh" in d for d in r.details))

    def test_fail_on_relative_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            r = _with_settings(root, {
                "hooks": {"PreToolUse": [{"hooks": [{"command": "bash relative/script.sh"}]}]},
            }, _run)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("relative/script.sh" in d for d in r.details))

    def test_warn_when_script_present_but_not_executable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / "exists-but-not-exec.sh"
            script.write_text("#!/bin/bash\n")
            mode = script.stat().st_mode
            script.chmod(mode & ~(stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH))
            r = _with_settings(root, {
                "hooks": {"Stop": [{"hooks": [{"command": str(script)}]}]},
            }, _run)
            self.assertEqual(r.status, "WARN", msg=f"summary={r.summary} details={r.details}")

    def test_error_when_hooks_value_wrong_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = _with_settings(Path(tmp), {"hooks": "not-a-dict"}, _run)
            self.assertEqual(r.status, "ERROR")

    def test_statusline_command_also_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            missing = root / "no-such-statusline.sh"
            r = _with_settings(root, {
                "hooks": {"Stop": [{"hooks": [{"command": "echo ok"}]}]},
                "statusLine": {"command": f"bash {missing}"},
            }, _run)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("statusLine" in d for d in r.details))


if __name__ == "__main__":
    unittest.main()
