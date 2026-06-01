#!/usr/bin/env python3
"""Unit tests for the repo-mermaid-freshness verifier."""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from helpers import (
    assert_class_shape, smoke_run, with_project_root, write_file,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
GENERATOR_SRC = REPO_ROOT / "tools/HME/scripts/generate-repo-mermaid.py"


def _classes():
    from verify_coherence.repo_mermaid_freshness import RepoMermaidFreshnessVerifier
    return (RepoMermaidFreshnessVerifier,)


def _seed_repo(root: Path, readme_extra: str = "") -> None:
    """Create a tiny tracked tree + drop the generator script in place."""
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=root, check=True)
    write_file(root, "src/README.md", "# src/\nComposition source.\n")
    write_file(root, "src/foo.js", "// stub\n")
    write_file(root, "README.md", "# Top\n\n<!-- BEGIN_REPO_MERMAID -->\n" + readme_extra + "<!-- END_REPO_MERMAID -->\n")
    scripts_dir = root / "tools/HME/scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(GENERATOR_SRC, scripts_dir / "generate-repo-mermaid.py")
    subprocess.run(["git", "add", "."], cwd=root, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "seed"], cwd=root, check=True)


def _run():
    from verify_coherence.repo_mermaid_freshness import RepoMermaidFreshnessVerifier
    return RepoMermaidFreshnessVerifier().run()


class RepoMermaidFreshnessTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        smoke_run(self, _classes())

    def test_warn_when_markers_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.email", "t@t"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.name", "t"], cwd=root, check=True)
            write_file(root, "README.md", "# Top\nno markers here.\n")
            scripts_dir = root / "tools/HME/scripts"
            scripts_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy(GENERATOR_SRC, scripts_dir / "generate-repo-mermaid.py")
            subprocess.run(["git", "add", "."], cwd=root, check=True)
            subprocess.run(["git", "commit", "-q", "-m", "seed"], cwd=root, check=True)
            r = with_project_root(root, _run)
            self.assertEqual(r.status, "WARN", msg=f"summary={r.summary}")
            self.assertTrue(any("missing the auto-generated block markers" in r.summary
                                or "BEGIN_REPO_MERMAID" in d for d in r.details + [r.summary]),
                            msg=f"summary={r.summary} details={r.details}")

    def test_warn_when_block_is_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            # Empty block — definitely doesn't match the freshly-generated one.
            _seed_repo(root, readme_extra="")
            r = with_project_root(root, _run)
            self.assertEqual(r.status, "WARN", msg=f"summary={r.summary}")
            self.assertIn("stale", r.summary)

    def test_pass_when_block_matches_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _seed_repo(root, readme_extra="")
            # Run the generator to populate the block correctly.
            subprocess.run(
                ["python3", "tools/HME/scripts/generate-repo-mermaid.py"],
                cwd=root, check=True,
            )
            subprocess.run(["git", "add", "README.md"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-q", "-m", "refresh"], cwd=root, check=True)
            r = with_project_root(root, _run)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")


class SubtreeLabelDisambiguationTests(unittest.TestCase):
    """Regression guard for the path-relative-label behaviour added in
    42f88918. Two sibling dirs that share a basename under different
    parents (e.g. `a/x/utils` and `a/y/utils`) must produce distinct
    labels in the subtree diagram, even though their node IDs are
    already unique."""

    def _build_subtree_block(self, tmp: Path) -> str:
        sys.path.insert(0, str(REPO_ROOT / "tools/HME/scripts"))
        gen_path = REPO_ROOT / "tools/HME/scripts/generate-repo-mermaid.py"
        import importlib.util
        spec = importlib.util.spec_from_file_location("_gen", gen_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        subprocess.run(["git", "init", "-q"], cwd=tmp, check=True)
        subprocess.run(["git", "config", "user.email", "t@t"], cwd=tmp, check=True)
        subprocess.run(["git", "config", "user.name", "t"], cwd=tmp, check=True)
        for rel in ("a/x/utils/x.txt", "a/y/utils/y.txt", "a/x/utils/README.md",
                    "a/y/utils/README.md", "a/README.md"):
            write_file(tmp, rel, "stub\n")
        subprocess.run(["git", "add", "."], cwd=tmp, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "seed"], cwd=tmp, check=True)
        return mod.build_subtree(tmp, Path("a"))

    def test_same_basename_dirs_get_distinct_labels(self):
        import re
        with tempfile.TemporaryDirectory() as tmp:
            block = self._build_subtree_block(Path(tmp))
        labels = re.findall(r'\["([^"]+?)(?:<br/>.*)?"\]', block)
        self.assertIn("a/", labels, msg=f"labels={labels}")
        self.assertIn("x/utils/", labels, msg=f"labels={labels}")
        self.assertIn("y/utils/", labels, msg=f"labels={labels}")
        # The bare basename "utils/" must NOT appear -- both should be
        # disambiguated by their parent path.
        self.assertNotIn("utils/", labels,
                         msg=f"undisambiguated label found; labels={labels}")


if __name__ == "__main__":
    unittest.main()
