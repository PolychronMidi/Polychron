#!/usr/bin/env python3
"""Unit tests for the forbidden-api-keys verifier.

Run: python3 tools/HME/tests/specs/forbidden_api_keys.test.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tools" / "HME" / "scripts"))

# Build the forbidden token fragments at runtime so this test source does
# not contain the literal strings -- otherwise the production verifier
A = "anth" + "ropic" + "_api_key"
O = "open" + "ai" + "_api_key"


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


def _write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


class ForbiddenApiKeysTests(unittest.TestCase):
    def test_pass_when_no_forbidden_identifiers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "src/lib.js", "const k = 'opencode_api_key';\n")
            _write(root, "tools/HME/proxy/x.js", "// claude OAuth only\n")

            def _run():
                from verify_coherence.forbidden_api_keys import ForbiddenApiKeysVerifier
                return ForbiddenApiKeysVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")
            self.assertEqual(r.score, 1.0)

    def test_fails_on_anthropic_key_regression(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "src/bad.js", f"const k = process.env.{A.upper()};\n")

            def _run():
                from verify_coherence.forbidden_api_keys import ForbiddenApiKeysVerifier
                return ForbiddenApiKeysVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL", msg=f"summary={r.summary} details={r.details}")
            self.assertTrue(any("src/bad.js" in d for d in r.details))

    def test_fails_on_openai_key_regression(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "tools/foo/y.py", f"import os; k = os.environ['{O.upper()}']\n")

            def _run():
                from verify_coherence.forbidden_api_keys import ForbiddenApiKeysVerifier
                return ForbiddenApiKeysVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL", msg=f"summary={r.summary} details={r.details}")
            self.assertTrue(any("tools/foo/y.py" in d for d in r.details))

    def test_case_insensitive_detection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "doc/note.txt", f"see config field {A.lower()} below\n")

            def _run():
                from verify_coherence.forbidden_api_keys import ForbiddenApiKeysVerifier
                return ForbiddenApiKeysVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL", msg=f"summary={r.summary} details={r.details}")
            self.assertTrue(any("doc/note.txt" in d for d in r.details))

    def test_self_exempt_verifier_module_not_flagged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root,
                "tools/HME/scripts/verify_coherence/forbidden_api_keys.py",
                f"# detects {A} and {O}\n",
            )

            def _run():
                from verify_coherence.forbidden_api_keys import ForbiddenApiKeysVerifier
                return ForbiddenApiKeysVerifier().run()
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")


if __name__ == "__main__":
    unittest.main()
