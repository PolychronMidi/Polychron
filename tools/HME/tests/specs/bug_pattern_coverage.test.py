#!/usr/bin/env python3
"""Unit tests for the bug-pattern-coverage verifier."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from helpers import (
    assert_class_shape, smoke_run, with_project_root, write_file,
)


def _classes():
    from verify_coherence.bug_pattern_coverage import BugPatternCoverageVerifier
    return (BugPatternCoverageVerifier,)


def _seed_repo(root: Path, commits: list[str]) -> None:
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=root, check=True)
    write_file(root, "seed.txt", "seed\n")
    subprocess.run(["git", "add", "."], cwd=root, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "seed"], cwd=root, check=True)
    for i, msg in enumerate(commits):
        (root / f"f{i}.txt").write_text(f"{i}\n")
        subprocess.run(["git", "add", f"f{i}.txt"], cwd=root, check=True)
        subprocess.run(["git", "commit", "-q", "-m", msg], cwd=root, check=True)


def _run():
    from verify_coherence.bug_pattern_coverage import BugPatternCoverageVerifier
    return BugPatternCoverageVerifier().run()


class BugPatternCoverageTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        smoke_run(self, _classes())

    def test_pass_when_no_fix_commits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _seed_repo(root, ["feat: add new feature", "docs: update README"])
            r = with_project_root(root, _run)
            self.assertEqual(r.status, "PASS",
                             msg=f"summary={r.summary} details={r.details}")

    def test_warn_when_fix_concern_lacks_verifier(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _seed_repo(root, [
                "fix: handle quantum tunneling edge case in cosmic dispatcher",
            ])
            r = with_project_root(root, _run)
            self.assertEqual(r.status, "WARN", msg=f"summary={r.summary}")
            joined = " ".join(r.details)
            self.assertTrue("quantum" in joined or "tunneling" in joined
                            or "cosmic" in joined,
                            msg=f"expected uncovered concern surfaced; details={r.details}")

    def test_waiver_silences_concern(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _seed_repo(root, [
                "fix: handle quantum tunneling edge case",
            ])
            write_file(root, "tools/HME/config/bug_pattern_waivers.json",
                       json.dumps({"waivers": [
                           {"concern": "quantum", "reason": "test"},
                           {"concern": "tunneling", "reason": "test"},
                           {"concern": "handle", "reason": "test"},
                           {"concern": "edge", "reason": "test"},
                       ]}))
            r = with_project_root(root, _run)
            joined = " ".join(r.details)
            for tok in ("quantum", "tunneling", "handle", "edge"):
                self.assertNotIn(tok, joined,
                                 msg=f"waivered concern {tok!r} still flagged: {r.details}")

    def test_stale_waiver_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _seed_repo(root, ["fix: legitimate concern that exists now"])
            write_file(root, "tools/HME/config/bug_pattern_waivers.json",
                       json.dumps({"waivers": [
                           {"concern": "obsolete_token_xyz", "reason": "stale"},
                       ]}))
            r = with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL", msg=f"summary={r.summary}")
            self.assertTrue(any("stale waiver" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_concern_covered_by_verifier_name_substring(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _seed_repo(root, ["fix: markdown invariant edge case"])
            r = with_project_root(root, _run)
            uncovered_tokens = [d.split(":", 1)[0] for d in r.details]
            self.assertNotIn("markdown", uncovered_tokens,
                             msg=f"'markdown' should match markdown-invariant verifier; "
                                 f"uncovered_tokens={uncovered_tokens}")


if __name__ == "__main__":
    unittest.main()
