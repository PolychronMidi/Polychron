"""Sibling test for buddy_registry.build() -- TDD floor."""
import json
import os
import tempfile
import unittest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "scripts"))


class TestBuddyRegistry(unittest.TestCase):

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()
        (Path(self._tmpdir) / ".env").write_text("")
        (Path(self._tmpdir) / ".git").mkdir()
        (Path(self._tmpdir) / "runtime" / "hme").mkdir(parents=True)
        (Path(self._tmpdir) / "tmp").mkdir(parents=True)
        os.environ["PROJECT_ROOT"] = self._tmpdir
        # Force buddy_registry to re-resolve with new env.
        for mod in ("buddy_registry", "repo_root"):
            sys.modules.pop(mod, None)

    def tearDown(self):
        import shutil
        shutil.rmtree(self._tmpdir, ignore_errors=True)
        os.environ.pop("PROJECT_ROOT", None)

    def test_empty_returns_empty_lists(self):
        import buddy_registry
        r = buddy_registry.build()
        self.assertEqual(r["primary"], {})
        self.assertEqual(r["legacy_alias"], {})
        self.assertEqual(r["slots"], [])
        self.assertEqual(r["seniors"], [])

    def test_primary_with_companions_loaded(self):
        rt = Path(self._tmpdir) / "runtime" / "hme"
        (rt / "buddy-primary.sid").write_text("abc123")
        (rt / "buddy-primary.floor").write_text("E3")
        (rt / "buddy-primary.effort_floor").write_text("medium")
        import buddy_registry
        r = buddy_registry.build()
        self.assertEqual(r["primary"]["sid"], "abc123")
        self.assertEqual(r["primary"]["floor"], "E3")
        self.assertEqual(r["primary"]["effort_floor"], "medium")

    def test_multi_buddy_slots_loaded(self):
        tmp = Path(self._tmpdir) / "tmp"
        (tmp / "hme-buddy-1.sid").write_text("sid1")
        (tmp / "hme-buddy-1.floor").write_text("E2")
        (tmp / "hme-buddy-2.sid").write_text("sid2")
        import buddy_registry
        r = buddy_registry.build()
        self.assertEqual(len(r["slots"]), 2)
        self.assertEqual(r["slots"][0]["sid"], "sid1")
        self.assertEqual(r["slots"][0]["floor"], "E2")


if __name__ == "__main__":
    unittest.main()
