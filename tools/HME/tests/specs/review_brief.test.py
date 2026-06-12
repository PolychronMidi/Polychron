"""Tests for review-brief compose + lint (no shebang: run via `python3 ...`).

Briefs are DATA composed into a peer review-request MESSAGE; the guard inlines
LIVE source at dispatch. These tests prove: every live brief lints clean against
current source, compose embeds NO frozen copy (references only), and the lint
catches a coverage symbol the live source no longer has (freshness gate).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "teams" / "rounds"))
os.environ.setdefault("PROJECT_ROOT", str(ROOT))

import review_brief  # noqa: E402


class ReviewBriefTests(unittest.TestCase):
    def test_all_live_briefs_lint_clean_against_live_source(self):
        self.assertEqual(review_brief.main(["--all"]), 0)

    def test_capsules_directory_is_gone(self):
        # The committed capsule .md directory was the circumvention -- it must
        # stay deleted; briefs live as data, sent as channel messages.
        self.assertFalse((ROOT / "teams" / "capsules").exists(),
                         "teams/capsules/ must not be reintroduced; briefs are data")

    def test_compose_references_live_source_not_embedded_copy(self):
        briefs = review_brief.load()
        key = next(iter(briefs))
        text = review_brief.compose(key, briefs)
        self.assertIn("## evidence", text)
        self.assertIn("Live source (read fresh at dispatch", text)
        self.assertNotIn("```", text, "composed brief must reference live source, never embed a fenced copy")

    def test_lint_flags_coverage_symbol_absent_from_live_source(self):
        guard = review_brief._guard()
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "pkg").mkdir()
            (root / "pkg" / "mod.py").write_text("def _present_fn():\n    return 1\n", encoding="utf-8")
            briefs = {"t": {
                "title": "t", "artifact": "pkg/mod.py", "goal": "g", "constraints": "c",
                "rubric": "r", "coverage_included": "_present_fn, _absent_fn",
                "coverage_excluded": "none", "evidence": ["pkg/mod.py"],
            }}
            text = review_brief.compose("t", briefs)
            resolved = guard._resolve_capsule(text, root, 24000)
            self.assertIn("def _present_fn", resolved, "live source must inline")
            gaps = guard._capsule_coverage_gaps(resolved)
            self.assertIn("_absent_fn", gaps)
            self.assertNotIn("_present_fn", gaps)

    def test_briefs_json_is_data_with_evidence_references(self):
        data = json.loads((ROOT / "teams" / "rounds" / "review-briefs.json").read_text(encoding="utf-8"))
        self.assertIn("briefs", data)
        self.assertGreater(len(data["briefs"]), 0)
        for key, b in data["briefs"].items():
            self.assertTrue(b.get("evidence"), f"{key} must reference at least one live source file")
            for ref in b["evidence"]:
                self.assertTrue((ROOT / ref).is_file(), f"{key} references missing source: {ref}")


if __name__ == "__main__":
    unittest.main()
