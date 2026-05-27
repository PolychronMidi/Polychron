#!/usr/bin/env python3
"""Unit tests for verifier-self-coverage.

Run: python3 tools/HME/tests/specs/verifier_self_coverage.test.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tools" / "HME" / "scripts"))


def _purge_modules():
    for mod in list(sys.modules.keys()):
        if mod == "verify_coherence" or mod.startswith("verify_coherence."):
            sys.modules.pop(mod, None)


def _with_fake_registry(tmpdir, registry_modules, waivers, fn):
    """Run fn() with PROJECT_ROOT=tmpdir and a synthetic REGISTRY of stub
    Verifier instances drawn from `registry_modules`."""
    prior_pr = os.environ.get("PROJECT_ROOT")
    prior_m = os.environ.get("HME_METRICS_DIR")
    os.environ["PROJECT_ROOT"] = str(tmpdir)
    os.environ["HME_METRICS_DIR"] = str(Path(tmpdir) / "tools/HME/runtime/metrics")
    _purge_modules()

    waivers_path = Path(tmpdir) / "tools/HME/config/verifier_test_waivers.json"
    waivers_path.parent.mkdir(parents=True, exist_ok=True)
    waivers_path.write_text(json.dumps({
        "waivers": [{"module": m, "reason": "test"} for m in waivers],
    }))

    try:
        import verify_coherence as vc
        from verify_coherence._base import Verifier
        stubs = []
        for mod in registry_modules:
            cls = type(f"Stub_{mod}", (Verifier,), {})
            cls.__module__ = f"verify_coherence.{mod}"
            stubs.append(cls())
        vc.REGISTRY = stubs
        return fn()
    finally:
        if prior_pr is None:
            del os.environ["PROJECT_ROOT"]
        else:
            os.environ["PROJECT_ROOT"] = prior_pr
        if prior_m is None:
            del os.environ["HME_METRICS_DIR"]
        else:
            os.environ["HME_METRICS_DIR"] = prior_m
        _purge_modules()


def _write_test_spec(root: Path, module: str) -> None:
    p = root / "tools/HME/tests/specs" / f"{module}.test.py"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("# stub test for " + module + "\n")


def _run_verifier():
    from verify_coherence.verifier_self_coverage import VerifierSelfCoverageVerifier
    return VerifierSelfCoverageVerifier().run()


class VerifierSelfCoverageTests(unittest.TestCase):
    def test_pass_when_every_module_has_a_test(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for m in ("alpha", "bravo"):
                _write_test_spec(root, m)
            r = _with_fake_registry(root, ["alpha", "bravo"], [], _run_verifier)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")

    def test_fail_when_module_lacks_test_and_no_waiver(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_test_spec(root, "alpha")
            r = _with_fake_registry(root, ["alpha", "bravo"], [], _run_verifier)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("bravo" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_waiver_silences_missing_test(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_test_spec(root, "alpha")
            r = _with_fake_registry(root, ["alpha", "bravo"], ["bravo"], _run_verifier)
            self.assertEqual(r.status, "WARN", msg=f"summary={r.summary}")

    def test_stale_waiver_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_test_spec(root, "alpha")
            _write_test_spec(root, "bravo")
            r = _with_fake_registry(root, ["alpha", "bravo"], ["bravo"], _run_verifier)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("stale" in d and "bravo" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_js_test_spec_counts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            p = root / "tools/HME/tests/specs/alpha.test.js"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("// stub js test\n")
            r = _with_fake_registry(root, ["alpha"], [], _run_verifier)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary}")


if __name__ == "__main__":
    unittest.main()
