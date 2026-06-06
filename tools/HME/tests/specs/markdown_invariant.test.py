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
    prior = {
        "PROJECT_ROOT": os.environ.get("PROJECT_ROOT"),
        "HME_METRICS_DIR": os.environ.get("HME_METRICS_DIR"),
        "METRICS_DIR": os.environ.get("METRICS_DIR"),
        "HME_IGNORE_DIRS": os.environ.get("HME_IGNORE_DIRS"),
        "OVERDRIVE_MODE": os.environ.get("OVERDRIVE_MODE"),
        "HME_ARBITER_PORT": os.environ.get("HME_ARBITER_PORT"),
        "HME_PROXY_PORT": os.environ.get("HME_PROXY_PORT"),
    }
    metrics = str(Path(tmpdir) / "tools/HME/runtime/metrics")
    os.environ["PROJECT_ROOT"] = str(tmpdir)
    os.environ["HME_METRICS_DIR"] = metrics
    os.environ["METRICS_DIR"] = metrics
    os.environ.setdefault("HME_IGNORE_DIRS", "node_modules,.git,tmp,log")
    os.environ.setdefault("OVERDRIVE_MODE", "0")
    os.environ.setdefault("HME_ARBITER_PORT", "0")
    os.environ.setdefault("HME_PROXY_PORT", "9099")
    for mod in list(sys.modules.keys()):
        if mod == "verify_coherence" or mod.startswith("verify_coherence."):
            sys.modules.pop(mod, None)
    try:
        return fn()
    finally:
        for key, value in prior.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
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
                "src/README.md",
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
            _write(root, "stray-notes.md", "this should not exist\n")

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("stray-notes.md" in d for d in r.details))

    def test_misplaced_canonical_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "src/metrics/composition.md", "drifted\n")

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
            _write(root, "README.md", "root\n")

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
            _write(root, "README.md", "root\n")

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "PASS", msg=f"details={r.details}")

    def test_team_channels_are_bounded_allowlist(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel in (
                "doc/composition.md",
                "doc/composition-full.md",
                "doc/self-coherence.md",
                "doc/self-coherence-full.md",
                "README.md",
                "teams/README.md",
                "teams/driver.md",
                "teams/red.md",
                "teams/blue.md",
                "teams/purple.md",
            ):
                _write(root, rel, "x\n")

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "PASS", msg=f"details={r.details}")

            _write(root, "teams/noise.md", "not a channel\n")
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("teams/noise.md" in d for d in r.details), msg=f"details={r.details}")

    def test_missing_dir_intent_readme_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel in (
                "doc/composition.md",
                "doc/composition-full.md",
                "doc/self-coherence.md",
                "doc/self-coherence-full.md",
                "README.md",
                "src/composers/lib.js",
            ):
                _write(root, rel, "stub\n")

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "WARN", msg=f"summary={r.summary} details={r.details}")
            self.assertTrue(any("src/" in d and "missing dir_intent" in d for d in r.details),
                            msg=f"details={r.details}")
            self.assertTrue(any("src/composers/" in d and "missing dir_intent" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_doc_subtree_does_not_require_readme(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel in (
                "doc/composition.md",
                "doc/composition-full.md",
                "doc/self-coherence.md",
                "doc/self-coherence-full.md",
                "doc/theory/essay.md",
                "doc/templates/whatever.md",
                "README.md",
            ):
                _write(root, rel, "x\n")

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")
            for d in r.details:
                self.assertNotIn("doc/", d, msg=f"doc/ subtree should not appear in details: {d}")

    def _canon(self, root):
        for rel in (
            "doc/composition.md", "doc/composition-full.md",
            "doc/self-coherence.md", "doc/self-coherence-full.md", "README.md",
        ):
            _write(root, rel, "x\n")

    def test_new_top_level_doc_is_subversion(self):
        # The exact subversion: a NEW top-level doc/*.md (data/report) riding the
        # old blanket doc/ grandfather. doc/ top level is the 4 canonical only.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._canon(root)
            _write(root, "doc/myth0s-coverage-map.md", "spillover doc\n" * 5)

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL", msg=f"details={r.details}")
            self.assertTrue(any("myth0s-coverage-map.md" in d for d in r.details), msg=f"details={r.details}")

    def test_doc_with_status_table_is_spillover(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._canon(root)
            _write(root, "doc/theory/sneaky.md",
                   "# essay\n\n| surface | file | status |\n| --- | --- | --- |\n"
                   "| a | a.js | reviewed |\n| b | b.js | pending |\n")

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL", msg=f"details={r.details}")
            self.assertTrue(any("status-tracking table" in d for d in r.details), msg=f"details={r.details}")

    def test_doc_with_todo_grammar_is_spillover(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._canon(root)
            _write(root, "doc/theory/tracker.md", "# notes\n\n#1 0_ do the thing\n#2 5_ done thing\n")

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL", msg=f"details={r.details}")
            self.assertTrue(any("TODO-tracking grammar" in d for d in r.details), msg=f"details={r.details}")

    def test_todo_template_grammar_is_exempt(self):
        # The canonical tracker legitimately carries todo-code grammar.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._canon(root)
            _write(root, "doc/templates/TODO.md", "### Todo - Set 1\n\n#1 0_ real work\n#2 5_ done\n")

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")

    def test_genuine_prose_essay_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._canon(root)
            _write(root, "doc/theory/on-coherence.md",
                   "# On Coherence\n\nLong-form prose about emergence, with the word "
                   "status used in a sentence and a | pipe | in passing.\n" * 20)

            def _run():
                from verify_coherence.markdown_invariant import MarkdownInvariantVerifier
                return MarkdownInvariantVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")


if __name__ == "__main__":
    unittest.main()
