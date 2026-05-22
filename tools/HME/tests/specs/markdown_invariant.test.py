#!/usr/bin/env python3
"""Unit tests for the markdown invariant verifier.

Run: python3 tools/HME/tests/specs/markdown_invariant.test.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tools" / "HME" / "scripts"))


def _with_project_root(tmpdir, fn):
    prior = os.environ.get("PROJECT_ROOT")
    prior_metrics = os.environ.get("HME_METRICS_DIR")
    os.environ["PROJECT_ROOT"] = str(tmpdir)
    os.environ["HME_METRICS_DIR"] = str(Path(tmpdir) / "tools/HME/runtime/metrics")
    for mod in list(sys.modules.keys()):
        if mod == "verify_coherence" or mod.startswith("verify_coherence."):
            sys.modules.pop(mod, None)
    try:
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
        for mod in list(sys.modules.keys()):
            if mod == "verify_coherence" or mod.startswith("verify_coherence."):
                sys.modules.pop(mod, None)


def _write(root: Path, rel: str, text: str = "x\n") -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


class MarkdownInvariantTests(unittest.TestCase):
    def test_pass_when_only_canonicals_and_concise_readmes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel in (
                "doc/composition.md",
                "doc/composition-full.md",
                "doc/self-coherence.md",
                "doc/self-coherence-full.md",
                "README.md",
                "src/composers/README.md",
            ):
                _write(root, rel, "short\n" * 5)

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")
            self.assertEqual(r.score, 1.0)

    def test_disallowed_filename_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "doc/composition.md")
            _write(root, "plan.md", "this should not exist\n")

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("plan.md" in d for d in r.details))

    def test_misplaced_canonical_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "src/output/metrics/composition.md", "drifted\n")

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertNotEqual(r.status, "PASS")
            self.assertTrue(any("composition.md must live at doc/composition.md" in d for d in r.details))

    def test_readme_over_size_limit_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel in (
                "doc/composition.md",
                "doc/composition-full.md",
                "doc/self-coherence.md",
                "doc/self-coherence-full.md",
            ):
                _write(root, rel)
            _write(root, "src/composers/README.md", "line\n" * 500)

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "WARN")
            self.assertTrue(any("src/composers/README.md" in d for d in r.details))

    def test_doc_theory_and_doc_templates_grandfathered(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel in (
                "doc/composition.md",
                "doc/composition-full.md",
                "doc/self-coherence.md",
                "doc/self-coherence-full.md",
                "doc/theory/some-essay.md",
                "doc/templates/ONBOARDING.md",
                "doc/templates/anything.md",
            ):
                _write(root, rel, "essay\n" * 200)

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")

    def test_skip_dirs_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel in (
                "doc/composition.md",
                "doc/composition-full.md",
                "doc/self-coherence.md",
                "doc/self-coherence-full.md",
                "node_modules/somepkg/README.md",
                "tools/models/m/README.md",
                "tools/smolagents/docs/something.md",
                "tools/omniroute/README.md",
                "tmp/scratch.md",
                "log/dump.md",
            ):
                _write(root, rel, "skip me\n" * 500)

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "PASS", msg=f"details={r.details}")


if __name__ == "__main__":
    unittest.main()
