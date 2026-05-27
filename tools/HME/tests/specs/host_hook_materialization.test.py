#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "tools" / "HME" / "scripts"))

import claude_settings  # noqa: E402


class HostHookMaterializationTests(unittest.TestCase):
    def test_hooks_manifest_routes_host_hooks_through_single_entrypoint(self):
        manifest = json.loads((ROOT / "tools/HME/hooks/hooks.json").read_text())
        for event, groups in manifest["hooks"].items():
            if event == "StatusLine":
                continue
            for group in groups:
                for hook in group.get("hooks", []):
                    command = hook.get("command", "")
                    self.assertIn("event_kernel/host_hook_entry.js", command, event)
                    self.assertIn("--host claude", command, event)
                    self.assertIn(f"--event {event}", command, event)
                    self.assertNotIn("claude_adapter.js", command, event)

    def test_codex_projection_uses_same_entrypoint_with_codex_host(self):
        projected = claude_settings.codex_expected_settings(ROOT)
        for event, groups in projected["hooks"].items():
            for group in groups:
                for hook in group.get("hooks", []):
                    command = hook.get("command", "")
                    self.assertIn("event_kernel/host_hook_entry.js", command, event)
                    self.assertIn("--host codex", command, event)
                    self.assertNotIn("codex_adapter.js", command, event)
                    self.assertNotIn("claude_adapter.js", command, event)

    def test_host_entry_supports_opencode_host(self):
        source = (ROOT / "tools/HME/event_kernel/host_hook_entry.js").read_text()
        self.assertIn("arg('host')", source)
        self.assertIn("opencode_adapter.js", source)

    def test_claude_projection_uses_hooks_tree_as_source_of_truth(self):
        projected = claude_settings.expected_settings(ROOT)
        self.assertIn("hooks", projected)
        self.assertIn("statusLine", projected)
        command_blob = json.dumps(projected)
        self.assertIn("event_kernel/host_hook_entry.js", command_blob)
        self.assertNotIn("tools/HME/hooks/pretooluse", command_blob)
        self.assertNotIn("tools/HME/hooks/posttooluse", command_blob)


if __name__ == "__main__":
    unittest.main()
