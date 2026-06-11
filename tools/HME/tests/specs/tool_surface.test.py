#!/usr/bin/env python3
"""Smoke + class-shape tests for verify_coherence.tool_surface."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from helpers import assert_class_shape, smoke_run


def _classes():
    from verify_coherence.tool_surface import ToolSurfaceCoverageVerifier, TodoMergeHookConsistencyVerifier
    return (ToolSurfaceCoverageVerifier, TodoMergeHookConsistencyVerifier)


class ToolSurfaceModuleTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        smoke_run(self, _classes())

    def test_todowrite_consistency_passes_when_native_mirror_retired(self):
        from verify_coherence.tool_surface import TodoMergeHookConsistencyVerifier
        r = TodoMergeHookConsistencyVerifier().run()
        self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")
        self.assertIn("retired", r.summary)

    def test_todowrite_consistency_rejects_blocking_restored_hook(self):
        from verify_coherence import tool_surface
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            hooks = root / "tools" / "HME" / "event_kernel" / "native_hooks"
            hooks.mkdir(parents=True)
            (hooks / "index.js").write_text("module.exports = { preToolHandlers: { TodoWrite: todo.pretoolTodoWrite } };\n", encoding="utf-8")
            (hooks / "todo.js").write_text(
                "async function pretoolTodoWrite(input) {\n"
                "  return hookBlock('freeze TodoWrite');\n"
                "}\n\n"
                "async function posttoolTodoWrite(input) { return input; }\n",
                encoding="utf-8",
            )
            old = tool_surface._PROJECT
            try:
                tool_surface._PROJECT = str(root)
                r = tool_surface.TodoMergeHookConsistencyVerifier().run()
            finally:
                tool_surface._PROJECT = old
        self.assertEqual(r.status, "FAIL")
        self.assertIn("blocking decision", r.summary)


if __name__ == "__main__":
    unittest.main()
