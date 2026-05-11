"""Sibling test for repo_root.resolve() -- TDD floor."""
import os
import tempfile
import unittest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import repo_root


class TestRepoRootResolve(unittest.TestCase):

    def test_uses_PROJECT_ROOT_env_var_when_valid(self):
        with tempfile.TemporaryDirectory() as td:
            (Path(td) / ".env").write_text("")
            (Path(td) / ".git").mkdir()
            os.environ["PROJECT_ROOT"] = td
            os.environ.pop("CLAUDE_PROJECT_DIR", None)
            try:
                self.assertEqual(repo_root.resolve(), td)
            finally:
                del os.environ["PROJECT_ROOT"]

    def test_falls_back_to_CLAUDE_PROJECT_DIR(self):
        with tempfile.TemporaryDirectory() as td:
            (Path(td) / ".env").write_text("")
            (Path(td) / ".git").mkdir()
            os.environ.pop("PROJECT_ROOT", None)
            os.environ["CLAUDE_PROJECT_DIR"] = td
            try:
                self.assertEqual(repo_root.resolve(), td)
            finally:
                del os.environ["CLAUDE_PROJECT_DIR"]

    def test_walks_up_when_env_vars_invalid(self):
        os.environ.pop("PROJECT_ROOT", None)
        os.environ.pop("CLAUDE_PROJECT_DIR", None)
        result = repo_root.resolve()
        self.assertTrue(os.path.isfile(os.path.join(result, ".env")))
        self.assertTrue(os.path.isdir(os.path.join(result, ".git")))


if __name__ == "__main__":
    unittest.main()
