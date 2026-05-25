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
    def test_expected_provider_points_at_hme_openai_compatible_ingress(self):
        provider = opencode_settings.expected_provider(9099, ROOT)
        self.assertEqual(provider["npm"], "@ai-sdk/openai-compatible")
        self.assertEqual(provider["options"]["baseURL"], "http://127.0.0.1:9099/v1")
        self.assertEqual(provider["options"]["apiKey"], "hme-local")
        self.assertTrue(provider["models"])

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

    def test_compare_config_detects_drift(self):
        live = {"provider": {"hme": {"options": {"baseURL": "https://example.invalid"}}}}
        drift = opencode_settings.compare_config(live, 9099, ROOT)
        self.assertTrue(drift)


if __name__ == "__main__":
    unittest.main()
