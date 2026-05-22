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


if __name__ == "__main__":
    unittest.main()
