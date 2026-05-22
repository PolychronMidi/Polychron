#!/usr/bin/env python3
"""Unit tests for the cross-context-isolation verifier."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from helpers import (
    assert_class_shape, smoke_run, with_project_root, write_file,
)


def _classes():
    from verify_coherence.cross_context_isolation import CrossContextIsolationVerifier
    return (CrossContextIsolationVerifier,)


def _seed_tree(root: Path, facade_a_target: str = "../../alpha_main.js",
               beta_uses_alpha_facade: bool = True) -> None:
    """Build a tiny fake proxy tree with two contexts (alpha, beta) and
    one infra file. `facade_a_target` controls what alpha's façade
    re-exports from; `beta_uses_alpha_facade` toggles whether beta's
    file reaches into alpha via the façade (compliant) or directly
    (violation)."""
    write_file(root, "tools/HME/config/proxy-contexts.json", json.dumps({
        "contexts": {
            "alpha": {
                "facade": "tools/HME/proxy/contexts/alpha/index.js",
                "files": ["tools/HME/proxy/alpha_main.js"],
            },
            "beta": {
                "facade": "tools/HME/proxy/contexts/beta/index.js",
                "files": ["tools/HME/proxy/beta_main.js"],
            },
        },
    }))
    write_file(root, "tools/HME/proxy/alpha_main.js",
               "module.exports = { alphaFn: () => 1 };\n")
    write_file(root, "tools/HME/proxy/contexts/alpha/index.js",
               f"module.exports = require('{facade_a_target}');\n")
    write_file(root, "tools/HME/proxy/contexts/beta/index.js",
               "module.exports = require('../../beta_main.js');\n")
    if beta_uses_alpha_facade:
        write_file(root, "tools/HME/proxy/beta_main.js",
                   "const a = require('./contexts/alpha');\n"
                   "module.exports = { betaFn: () => a.alphaFn() };\n")
    else:
        write_file(root, "tools/HME/proxy/beta_main.js",
                   "const a = require('./alpha_main');\n"
                   "module.exports = { betaFn: () => a.alphaFn() };\n")
    write_file(root, "tools/HME/proxy/shared_helper.js",
               "module.exports = { util: () => 0 };\n")


def _run():
    from verify_coherence.cross_context_isolation import CrossContextIsolationVerifier
    return CrossContextIsolationVerifier().run()


class CrossContextIsolationTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        smoke_run(self, _classes())

    def test_skip_when_registry_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = with_project_root(Path(tmp), _run)
            self.assertEqual(r.status, "SKIP", msg=f"summary={r.summary}")

    def test_pass_when_cross_context_call_uses_facade(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _seed_tree(root, beta_uses_alpha_facade=True)
            r = with_project_root(root, _run)
            self.assertEqual(r.status, "PASS",
                             msg=f"summary={r.summary} details={r.details}")

    def test_warn_when_cross_context_call_bypasses_facade(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _seed_tree(root, beta_uses_alpha_facade=False)
            r = with_project_root(root, _run)
            self.assertEqual(r.status, "WARN", msg=f"summary={r.summary}")
            joined = " ".join(r.details)
            self.assertIn("beta_main.js", joined, msg=f"details={r.details}")
            self.assertIn("alpha_main.js", joined, msg=f"details={r.details}")
            self.assertIn("contexts/alpha/", joined, msg=f"details={r.details}")

    def test_intra_context_calls_are_silent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_file(root, "tools/HME/config/proxy-contexts.json",
                       json.dumps({"contexts": {"alpha": {
                           "facade": "tools/HME/proxy/contexts/alpha/index.js",
                           "files": ["tools/HME/proxy/alpha_main.js",
                                     "tools/HME/proxy/alpha_helper.js"],
                       }}}))
            write_file(root, "tools/HME/proxy/alpha_main.js",
                       "const h = require('./alpha_helper');\n"
                       "module.exports = { main: () => h.x() };\n")
            write_file(root, "tools/HME/proxy/alpha_helper.js",
                       "module.exports = { x: () => 1 };\n")
            write_file(root, "tools/HME/proxy/contexts/alpha/index.js",
                       "module.exports = require('../../alpha_main.js');\n")
            r = with_project_root(root, _run)
            self.assertEqual(r.status, "PASS",
                             msg=f"intra-context reach got flagged: {r.details}")

    def test_infra_reach_is_silent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_file(root, "tools/HME/config/proxy-contexts.json",
                       json.dumps({"contexts": {"alpha": {
                           "facade": "tools/HME/proxy/contexts/alpha/index.js",
                           "files": ["tools/HME/proxy/alpha_main.js"],
                       }}}))
            write_file(root, "tools/HME/proxy/alpha_main.js",
                       "const u = require('./hme_paths');\n"
                       "module.exports = { main: () => u.something() };\n")
            write_file(root, "tools/HME/proxy/hme_paths.js",
                       "module.exports = { something: () => 1 };\n")
            write_file(root, "tools/HME/proxy/contexts/alpha/index.js",
                       "module.exports = require('../../alpha_main.js');\n")
            r = with_project_root(root, _run)
            self.assertEqual(r.status, "PASS",
                             msg=f"infra reach got flagged: {r.details}")


    def test_allowed_reach_waiver_silences_violation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _seed_tree(root, beta_uses_alpha_facade=False)
            # Add waiver for beta_main.js -> alpha_main.js
            reg_path = root / "tools/HME/config/proxy-contexts.json"
            data = json.loads(reg_path.read_text())
            data["allowed_reaches"] = [{
                "from": "tools/HME/proxy/beta_main.js",
                "to": "tools/HME/proxy/alpha_main.js",
                "reason": "test cycle-break",
            }]
            reg_path.write_text(json.dumps(data))
            r = with_project_root(root, _run)
            self.assertEqual(r.status, "PASS",
                             msg=f"waiver did not silence reach: {r.summary} {r.details}")

    def test_stale_waiver_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _seed_tree(root, beta_uses_alpha_facade=True)
            # Waiver for a reach that doesn't occur -- should FAIL as stale.
            reg_path = root / "tools/HME/config/proxy-contexts.json"
            data = json.loads(reg_path.read_text())
            data["allowed_reaches"] = [{
                "from": "tools/HME/proxy/beta_main.js",
                "to": "tools/HME/proxy/alpha_main.js",
                "reason": "stale -- beta goes through facade",
            }]
            reg_path.write_text(json.dumps(data))
            r = with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL", msg=f"summary={r.summary}")
            self.assertTrue(any("stale allowed_reach" in d for d in r.details),
                            msg=f"details={r.details}")


if __name__ == "__main__":
    unittest.main()
