#!/usr/bin/env python3
"""Unit tests for the env-no-fallback verifier.

Run: python3 tools/HME/tests/specs/env_no_fallback.test.py
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tools" / "HME" / "scripts"))

SAMPLE_NAME = "." + "env" + "." + "example"
TEMPLATE_REL = Path("doc") / "templates" / SAMPLE_NAME
CHECKER_REL = Path("tools") / "HME" / "scripts" / "check-env-failfast.py"
DECLARED_KEY = "TEST_DECLARED_KEY"


def _with_project_root(tmpdir: Path, fn):
    prior = {
        "PROJECT_ROOT": os.environ.get("PROJECT_ROOT"),
        "HME_METRICS_DIR": os.environ.get("HME_METRICS_DIR"),
        "METRICS_DIR": os.environ.get("METRICS_DIR"),
    }
    os.environ["PROJECT_ROOT"] = str(tmpdir)
    metrics = str(tmpdir / "tools/HME/runtime/metrics")
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


def _write(root: Path, rel: str | Path, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def _git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def _git_add(root: Path) -> None:
    _git(root, "add", ".")


def _stage_tree(root: Path) -> None:
    _write(root, CHECKER_REL, (REPO_ROOT / CHECKER_REL).read_text(encoding="utf-8"))
    _write(root, TEMPLATE_REL, f"PROJECT_ROOT={root}\n{DECLARED_KEY}=value\n")
    _write(root, ".env", f"PROJECT_ROOT={root}\n{DECLARED_KEY}=present\n")
    _git(root, "init")
    _git_add(root)


class EnvNoFallbackTests(unittest.TestCase):
    def _verifier(self):
        from verify_coherence.env_no_fallback import EnvNoFallbackVerifier
        return EnvNoFallbackVerifier()

    def test_passes_when_central_checker_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _stage_tree(root)
            r = _with_project_root(root, lambda: self._verifier().run())
            self.assertEqual(r.status, "PASS", msg=f"{r.summary} {r.details}")
            self.assertEqual(r.score, 1.0)

    def test_fails_when_root_env_missing_declared_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _stage_tree(root)
            _write(root, ".env", f"PROJECT_ROOT={root}\n")
            _git_add(root)
            r = _with_project_root(root, lambda: self._verifier().run())
            self.assertEqual(r.status, "FAIL", msg=f"{r.summary} {r.details}")
            self.assertTrue(any("missing declared key" in d for d in r.details))

    def test_fails_on_inline_fallback_for_declared_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _stage_tree(root)
            _write(root, "sample_bad.py", f"import os\nx = os.environ.get('{DECLARED_KEY}', 'fallback')\n")
            _git_add(root)
            r = _with_project_root(root, lambda: self._verifier().run())
            self.assertEqual(r.status, "FAIL", msg=f"{r.summary} {r.details}")
            self.assertTrue(any("sample_bad.py" in d for d in r.details))

    def test_fails_on_non_authority_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _stage_tree(root)
            forbidden = (Path("doc") / "templates" / SAMPLE_NAME).as_posix()
            _write(root, "sample_ref.py", f"REF = {forbidden!r}\n")
            _git_add(root)
            r = _with_project_root(root, lambda: self._verifier().run())
            self.assertEqual(r.status, "FAIL", msg=f"{r.summary} {r.details}")
            self.assertTrue(any("only allowed" in d for d in r.details))

    def test_fails_when_root_sample_file_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _stage_tree(root)
            _write(root, SAMPLE_NAME, "SHOULD_NOT_EXIST=1\n")
            r = _with_project_root(root, lambda: self._verifier().run())
            self.assertEqual(r.status, "FAIL", msg=f"{r.summary} {r.details}")
            self.assertTrue(any("must not exist" in d for d in r.details))


if __name__ == "__main__":
    unittest.main()
