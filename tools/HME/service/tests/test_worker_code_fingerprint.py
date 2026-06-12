"""Sibling test for worker_code_fingerprint -- the worker-side stale-code guard.

Mirrors the proxy runtime fingerprint: the worker hashes the code it actually
loaded so the supervisor can detect "alive but serving stale code" and restart
it. Worker-scoped only (worker.py + server/**) -- NOT coupled to the proxy
fingerprint, so a worker edit never churns the proxy slots.
"""
import hashlib
import os
import tempfile
import unittest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
import worker_code_fingerprint as wcf


class TestWorkerCodeFingerprint(unittest.TestCase):
    def _tree(self):
        td = tempfile.mkdtemp()
        svc = Path(td) / "tools" / "HME" / "service"
        (svc / "server").mkdir(parents=True)
        (svc / "worker.py").write_text("print('w')\n")
        (svc / "server" / "a.py").write_text("x = 1\n")
        (svc / "server" / "b.py").write_text("y = 2\n")
        return td

    def test_deterministic_for_same_tree(self):
        td = self._tree()
        try:
            self.assertEqual(wcf.compute(td), wcf.compute(td))
        finally:
            __import__("shutil").rmtree(td, ignore_errors=True)

    def test_changes_when_a_loaded_file_changes(self):
        td = self._tree()
        try:
            before = wcf.compute(td)
            (Path(td) / "tools" / "HME" / "service" / "server" / "a.py").write_text("x = 999\n")
            self.assertNotEqual(before, wcf.compute(td))
        finally:
            __import__("shutil").rmtree(td, ignore_errors=True)

    def test_changes_when_worker_py_changes(self):
        td = self._tree()
        try:
            before = wcf.compute(td)
            (Path(td) / "tools" / "HME" / "service" / "worker.py").write_text("print('changed')\n")
            self.assertNotEqual(before, wcf.compute(td))
        finally:
            __import__("shutil").rmtree(td, ignore_errors=True)

    def test_ignores_non_python_and_caches(self):
        td = self._tree()
        try:
            before = wcf.compute(td)
            # a .pyc / log / data file must not move the fingerprint
            (Path(td) / "tools" / "HME" / "service" / "server" / "note.txt").write_text("hi\n")
            (Path(td) / "tools" / "HME" / "service" / "server" / "c.pyc").write_text("bin\n")
            self.assertEqual(before, wcf.compute(td))
        finally:
            __import__("shutil").rmtree(td, ignore_errors=True)

    def test_short_hex_string(self):
        td = self._tree()
        try:
            fp = wcf.compute(td)
            self.assertIsInstance(fp, str)
            self.assertEqual(len(fp), 12)
            int(fp, 16)  # valid hex
        finally:
            __import__("shutil").rmtree(td, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
