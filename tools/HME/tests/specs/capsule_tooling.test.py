"""Tests for E1: capsule generator + linter (no shebang: run via `python3 ...`)."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "teams" / "rounds"))
os.environ.setdefault("PROJECT_ROOT", str(ROOT))

import capsule_gen  # noqa: E402
import capsule_lint  # noqa: E402


class CapsuleGenLintTests(unittest.TestCase):
    def test_generated_capsule_passes_lint_by_construction(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "sample.py"
            src.write_text(
                "def _alpha_helper(x):\n    return x\n\n"
                "def _beta_thing(y):\n    return y + 1\n",
                encoding="utf-8",
            )
            capsule_text = capsule_gen.generate(src, title="review sample.py")
            cap = Path(td) / "sample.md"
            cap.write_text(capsule_text, encoding="utf-8")
            # The generator must seed coverage with symbols from the evidence, so
            # the guard's coverage<->evidence check has no gaps.
            self.assertIn("_alpha_helper", capsule_text)
            self.assertIn("## evidence", capsule_text)
            r = capsule_lint.lint_capsule(cap)
            self.assertEqual(r["coverage_gaps"], [], r)
            # Required sections are all present in the skeleton.
            self.assertEqual(r["missing_sections"], [], r)
            self.assertTrue(r["ok"])

    def test_lint_flags_a_coverage_gap(self):
        with tempfile.TemporaryDirectory() as td:
            cap = Path(td) / "bad.md"
            cap.write_text(
                "# Context Capsule: bad\n\n"
                "## artifact\nx.js -- thing\n\n"
                "## goal\ng\n\n"
                "## rubric\nr\n\n"
                "## coverage\nincluded: _missing_symbol_xyz.\nexcluded: none.\n\n"
                "## evidence\nx.js\n```js\nfunction present_fn() {}\n```\n",
                encoding="utf-8",
            )
            r = capsule_lint.lint_capsule(cap)
            self.assertIn("_missing_symbol_xyz", r["coverage_gaps"])
            self.assertFalse(r["ok"])

    def test_lint_flags_missing_required_section(self):
        with tempfile.TemporaryDirectory() as td:
            cap = Path(td) / "nogoal.md"
            cap.write_text(
                "# Context Capsule: nogoal\n\n"
                "## artifact\nx.js -- thing\n\n"
                "## rubric\nr\n\n"
                "## evidence\nx.js\n```js\nok\n```\n",
                encoding="utf-8",
            )
            r = capsule_lint.lint_capsule(cap)
            self.assertIn("goal", r["missing_sections"])
            self.assertFalse(r["ok"])

    def test_lint_all_live_capsules_are_clean(self):
        # The whole capsule library must already pass the lint (regression guard).
        self.assertEqual(capsule_lint.main(["--all"]), 0)


if __name__ == "__main__":
    unittest.main()
