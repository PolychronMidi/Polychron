#!/usr/bin/env python3
"""Unit tests for the env-no-fallback verifier.

Run: python3 tools/HME/tests/specs/env_no_fallback.test.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tools" / "HME" / "scripts"))


def _with_project_root(tmpdir: Path, fn):
    """Run `fn` with PROJECT_ROOT pointing at tmpdir; restore on exit.

    Forces re-import of verify_coherence so module-level paths
    (_PROJECT, _SCAN_DIR, _TEMPLATE) resolve under the temp tree.
    """
    prior = {
        "PROJECT_ROOT": os.environ.get("PROJECT_ROOT"),
        "HME_METRICS_DIR": os.environ.get("HME_METRICS_DIR"),
        "METRICS_DIR": os.environ.get("METRICS_DIR"),
    }
    os.environ["PROJECT_ROOT"] = str(tmpdir)
    metrics = str(Path(tmpdir) / "tools/HME/runtime/metrics")
    os.environ["HME_METRICS_DIR"] = metrics
    os.environ["METRICS_DIR"] = metrics
    for mod in list(sys.modules.keys()):
        if mod == "verify_coherence" or mod.startswith("verify_coherence."):
            sys.modules.pop(mod, None)
    try:
        return fn()
    finally:
        for k, v in prior.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        for mod in list(sys.modules.keys()):
            if mod == "verify_coherence" or mod.startswith("verify_coherence."):
                sys.modules.pop(mod, None)


def _write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


_TEMPLATE_REL = "doc/templates/.env.example"
_SCAN_REL = "tools/HME/scripts/verify_coherence"
_PRODUCTION_VERIFIER_REL = f"{_SCAN_REL}/env_no_fallback.py"

# Minimal .env.example declaring a couple of keys the test verifier files
# can legitimately access. Keys must match the production regex
_TEMPLATE_TEXT = """\
# test template
PROJECT_ROOT=fixture
HME_METRICS_DIR=fixture/m
METRICS_DIR=fixture/m
TEST_DECLARED_KEY=value
ANOTHER_KEY=value
"""


def _stage_tree(root: Path) -> None:
    """Lay out the minimum tree the verifier expects."""
    _write(root, _TEMPLATE_REL, _TEMPLATE_TEXT)
    # Copy the real production verifier into the temp tree so
    # _SCAN_DIR contains it (the verifier self-exempts via _SELF_REL).
    real = REPO_ROOT / _PRODUCTION_VERIFIER_REL
    _write(root, _PRODUCTION_VERIFIER_REL, real.read_text(encoding="utf-8"))


class EnvNoFallbackTests(unittest.TestCase):
    def _verifier(self):
        from verify_coherence.env_no_fallback import EnvNoFallbackVerifier
        return EnvNoFallbackVerifier()

    def test_pass_when_only_strict_subscript_for_declared_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _stage_tree(root)
            _write(root, f"{_SCAN_REL}/sample_clean.py",
                   "import os\n"
                   "x = os.environ['TEST_DECLARED_KEY']\n"
                   "y = os.environ['ANOTHER_KEY']\n")
            r = _with_project_root(root, lambda: self._verifier().run())
            self.assertEqual(r.status, "PASS", msg=f"{r.summary} {r.details}")
            self.assertEqual(r.score, 1.0)

    def test_fail_on_implicit_none_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _stage_tree(root)
            _write(root, f"{_SCAN_REL}/sample_implicit.py",
                   "import os\n"
                   "x = os.environ.get('TEST_DECLARED_KEY')\n")
            r = _with_project_root(root, lambda: self._verifier().run())
            self.assertEqual(r.status, "FAIL", msg=f"{r.summary} {r.details}")
            self.assertTrue(any("sample_implicit.py" in d for d in r.details))

    def test_fail_on_explicit_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _stage_tree(root)
            _write(root, f"{_SCAN_REL}/sample_default.py",
                   "import os\n"
                   "x = os.environ.get('TEST_DECLARED_KEY', '/fallback')\n")
            r = _with_project_root(root, lambda: self._verifier().run())
            self.assertEqual(r.status, "FAIL", msg=f"{r.summary} {r.details}")
            self.assertTrue(any("sample_default.py" in d for d in r.details))

    def test_fail_on_explicit_none_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _stage_tree(root)
            _write(root, f"{_SCAN_REL}/sample_none.py",
                   "import os\n"
                   "x = os.environ.get('TEST_DECLARED_KEY', None)\n")
            r = _with_project_root(root, lambda: self._verifier().run())
            self.assertEqual(r.status, "FAIL", msg=f"{r.summary} {r.details}")

    def test_fail_on_disjunctive_or_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _stage_tree(root)
            _write(root, f"{_SCAN_REL}/sample_or.py",
                   "import os\n"
                   "x = os.environ.get('TEST_DECLARED_KEY') or '/fallback'\n")
            r = _with_project_root(root, lambda: self._verifier().run())
            self.assertEqual(r.status, "FAIL", msg=f"{r.summary} {r.details}")

    def test_fail_on_env_to_env_chain(self):
        """No legitimate env chains: even an env-to-env `or` is forbidden."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _stage_tree(root)
            _write(root, f"{_SCAN_REL}/sample_chain.py",
                   "import os\n"
                   "x = os.environ.get('TEST_DECLARED_KEY') or os.environ['ANOTHER_KEY']\n")
            r = _with_project_root(root, lambda: self._verifier().run())
            self.assertEqual(r.status, "FAIL", msg=f"{r.summary} {r.details}")

    def test_undeclared_keys_are_ignored(self):
        """Keys not in .env.example are out of scope (test-only flags, etc.)."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _stage_tree(root)
            _write(root, f"{_SCAN_REL}/sample_undeclared.py",
                   "import os\n"
                   "x = os.environ.get('SOME_TEST_FLAG', '0')\n")
            r = _with_project_root(root, lambda: self._verifier().run())
            self.assertEqual(r.status, "PASS", msg=f"{r.summary} {r.details}")

    def test_self_file_exempt(self):
        """The verifier's own source must not flag itself."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _stage_tree(root)
            # No other files staged -- only the verifier itself, which is
            # self-exempt; result must be PASS.
            r = _with_project_root(root, lambda: self._verifier().run())
            self.assertEqual(r.status, "PASS", msg=f"{r.summary} {r.details}")


if __name__ == "__main__":
    unittest.main()
