#!/usr/bin/env python3
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))

import opencode_settings  # noqa: E402


class OpenCodeSettingsTests(unittest.TestCase):
    def test_expected_provider_uses_openai_responses_ingress(self):
        provider = opencode_settings.expected_provider(9099, ROOT)
        self.assertEqual(provider["npm"], "@ai-sdk/openai")
        self.assertEqual(provider["options"]["baseURL"], "http://127.0.0.1:9099/v1")
        self.assertEqual(provider["options"]["apiKey"], "hme-local")
        self.assertTrue(provider["models"])
        model = provider["models"]["gpt-5.5-xhigh"]
        self.assertIn("limit", model)
        self.assertIn("context", model["limit"])
        self.assertIn("output", model["limit"])
        self.assertNotIn("context", model)

    def test_provider_catalog_excludes_skipped_claude_anthropic_models(self):
        provider = opencode_settings.expected_provider(9099, ROOT)
        ids = set(provider["models"].keys())
        self.assertNotIn("claude-opus-4-7-max-e5", ids)
        self.assertIn("gpt-5.5-xhigh", ids)

    def test_managed_config_preserves_unrelated_settings(self):
        base = {"$schema": "https://opencode.ai/config.json", "theme": "system", "provider": {"other": {"name": "Other"}}}
        out = opencode_settings.managed_config(base, 9099, ROOT)
        self.assertEqual(out["theme"], "system")
        self.assertIn("other", out["provider"])
        self.assertIn("hme", out["provider"])

    def test_managed_config_adds_default_models_without_overwriting_user_choice(self):
        out = opencode_settings.managed_config({}, 9099, ROOT)
        self.assertEqual(out["model"], opencode_settings.DEFAULT_MODEL)
        self.assertEqual(out["small_model"], opencode_settings.DEFAULT_SMALL_MODEL)
        custom = opencode_settings.managed_config({"model": "hme/custom", "small_model": "hme/small"}, 9099, ROOT)
        self.assertEqual(custom["model"], "hme/custom")
        self.assertEqual(custom["small_model"], "hme/small")

    def test_compare_config_detects_drift(self):
        live = {"provider": {"hme": {"options": {"baseURL": "https://example.invalid"}}}}
        drift = opencode_settings.compare_config(live, 9099, ROOT)
        self.assertTrue(drift)

    def test_strip_jsonc_preserves_url_strings_and_removes_comments(self):
        raw = '{"url":"http://127.0.0.1:9099/v1", // comment\n "x": 1, /* block */ "y": 2}'
        parsed = opencode_settings.json.loads(opencode_settings.strip_jsonc(raw))
        self.assertEqual(parsed["url"], "http://127.0.0.1:9099/v1")
        self.assertEqual(parsed["y"], 2)


if __name__ == "__main__":
    unittest.main()
