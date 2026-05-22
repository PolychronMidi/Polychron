#!/usr/bin/env python3
"""Behavioural + smoke tests for verify_coherence.env_settings."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[0]))
from _verifier_smoke import assert_class_shape, smoke_run, with_project_root


def _classes():
    from verify_coherence.env_settings import (
        SettingsJsonVerifier, OAuthTokenExpiryVerifier,
        EnvTamperVerifier, EnvLoadVerifier,
    )
    return (SettingsJsonVerifier, OAuthTokenExpiryVerifier, EnvTamperVerifier, EnvLoadVerifier)


_REAL_EXPANDUSER = os.path.expanduser


def _with_home_settings(tmp: Path, settings: dict | str | None, fn):
    """Mock ~/.claude/settings.json to point at tmp/settings.json.

    Pass `settings` as a dict to write JSON, as a str to write raw text
    (for malformed-JSON cases), or None to leave the file absent.
    """
    settings_path = tmp / "settings.json"
    if isinstance(settings, dict):
        settings_path.write_text(json.dumps(settings))
    elif isinstance(settings, str):
        settings_path.write_text(settings)
    def _eu(p):
        if p == "~/.claude/settings.json":
            return str(settings_path)
        return _REAL_EXPANDUSER(p)
    with mock.patch("os.path.expanduser", side_effect=_eu):
        return fn()


def _run_settings():
    from verify_coherence.env_settings import SettingsJsonVerifier
    return SettingsJsonVerifier().run()


def _run_tamper():
    from verify_coherence.env_settings import EnvTamperVerifier
    return EnvTamperVerifier().run()


CANONICAL_HOOKS = {
    "SessionStart": [{"hooks": [{"command": "echo ok"}]}],
    "UserPromptSubmit": [{"hooks": [{"command": "echo ok"}]}],
    "PreToolUse": [{"hooks": [{"command": "echo ok"}]}],
    "PostToolUse": [{"hooks": [{"command": "echo ok"}]}],
    "Stop": [{"hooks": [{"command": "echo ok"}]}],
}


class EnvSettingsSmokeTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        smoke_run(self, _classes())


class SettingsJsonBehaviourTests(unittest.TestCase):
    def test_skip_when_settings_file_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = _with_home_settings(Path(tmp), None, _run_settings)
            self.assertEqual(r.status, "SKIP")

    def test_pass_on_canonical_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = _with_home_settings(Path(tmp), {"hooks": CANONICAL_HOOKS}, _run_settings)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")

    def test_fail_on_malformed_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = _with_home_settings(Path(tmp), "{not valid", _run_settings)
            self.assertEqual(r.status, "FAIL")
            self.assertIn("MALFORMED", r.summary)

    def test_fail_when_required_lifecycle_event_missing(self):
        partial = dict(CANONICAL_HOOKS)
        partial.pop("Stop")
        with tempfile.TemporaryDirectory() as tmp:
            r = _with_home_settings(Path(tmp), {"hooks": partial}, _run_settings)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("missing lifecycle events" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_fail_when_root_is_not_object(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = _with_home_settings(Path(tmp), '["array root"]', _run_settings)
            self.assertEqual(r.status, "FAIL")
            self.assertIn("expected object", r.summary)


class EnvTamperBehaviourTests(unittest.TestCase):
    def test_baseline_established_on_first_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".env").write_text("KEY=value\n")
            r = with_project_root(root, _run_tamper)
            self.assertEqual(r.status, "PASS")
            self.assertIn("baseline established", r.summary)
            self.assertTrue((root / ".env.sha256").is_file())

    def test_pass_when_env_matches_baseline(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".env").write_text("KEY=value\n")
            with_project_root(root, _run_tamper)
            r2 = with_project_root(root, _run_tamper)
            self.assertEqual(r2.status, "PASS")
            self.assertIn("matches baseline", r2.summary)

    def test_fail_when_env_drifts_from_baseline(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".env").write_text("KEY=value\n")
            with_project_root(root, _run_tamper)
            (root / ".env").write_text("KEY=different\n")
            r2 = with_project_root(root, _run_tamper)
            self.assertEqual(r2.status, "FAIL")
            self.assertIn("changed since last baseline", r2.summary)

    def test_skip_when_env_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = with_project_root(Path(tmp), _run_tamper)
            self.assertEqual(r.status, "SKIP")


if __name__ == "__main__":
    unittest.main()
