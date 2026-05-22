#!/usr/bin/env python3
"""Unit tests for the cross-language-contract verifier.

Run: python3 tools/HME/tests/specs/cross_language_contracts.test.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tools" / "HME" / "scripts"))


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


def _run_verifier():
    from verify_coherence.cross_language_contracts import CrossLanguageContractsVerifier
    return CrossLanguageContractsVerifier().run()


class CrossLanguageContractsTests(unittest.TestCase):
    def test_skip_when_registry_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = _with_project_root(Path(tmp), _run_verifier)
            self.assertEqual(r.status, "SKIP", msg=f"summary={r.summary}")

    def test_pass_when_shared_set_in_lockstep(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "py/mod.py", 'MUTATING_EFFECTS = {"write", "edit", "shell"}\n')
            _write(root, "js/mod.js",
                   "const MUTATING_EFFECTS = new Set(['write', 'edit', 'shell']);\n")
            registry = {
                "shared_sets": [{
                    "name": "MUTATING_EFFECTS",
                    "values": ["write", "edit", "shell"],
                    "sites": [
                        {"file": "py/mod.py", "pattern": r"MUTATING_EFFECTS\s*=\s*\{([^}]+)\}"},
                        {"file": "js/mod.js", "pattern": r"MUTATING_EFFECTS\s*=\s*new\s+Set\(\[([^\]]+)\]\)"},
                    ],
                }],
            }
            _write(root, "tools/HME/config/cross_language_contracts.json",
                   json.dumps(registry))
            r = _with_project_root(root, _run_verifier)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")

    def test_fail_on_shared_set_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "py/mod.py",
                   'MUTATING_EFFECTS = {"write", "edit", "shell", "extra"}\n')
            _write(root, "js/mod.js",
                   "const MUTATING_EFFECTS = new Set(['write', 'edit']);\n")
            registry = {
                "shared_sets": [{
                    "name": "MUTATING_EFFECTS",
                    "values": ["write", "edit", "shell"],
                    "sites": [
                        {"file": "py/mod.py", "pattern": r"MUTATING_EFFECTS\s*=\s*\{([^}]+)\}"},
                        {"file": "js/mod.js", "pattern": r"MUTATING_EFFECTS\s*=\s*new\s+Set\(\[([^\]]+)\]\)"},
                    ],
                }],
            }
            _write(root, "tools/HME/config/cross_language_contracts.json",
                   json.dumps(registry))
            r = _with_project_root(root, _run_verifier)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("py/mod.py" in d and "extra" in d for d in r.details),
                            msg=f"details={r.details}")
            self.assertTrue(any("js/mod.js" in d and "missing" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_pass_function_pair_when_both_symbols_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "py/mod.py", "def to_omo(x):\n    return x\n")
            _write(root, "js/mod.js", "function toOmo(x) { return x; }\n")
            registry = {
                "function_pairs": [{
                    "name": "pair-A",
                    "py": {"file": "py/mod.py", "symbol": "to_omo"},
                    "js": {"file": "js/mod.js", "symbol": "toOmo"},
                }],
            }
            _write(root, "tools/HME/config/cross_language_contracts.json",
                   json.dumps(registry))
            r = _with_project_root(root, _run_verifier)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")

    def test_fail_function_pair_when_js_symbol_renamed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "py/mod.py", "def to_omo(x):\n    return x\n")
            _write(root, "js/mod.js", "function toOmoRenamed(x) { return x; }\n")
            registry = {
                "function_pairs": [{
                    "name": "pair-A",
                    "py": {"file": "py/mod.py", "symbol": "to_omo"},
                    "js": {"file": "js/mod.js", "symbol": "toOmo"},
                }],
            }
            _write(root, "tools/HME/config/cross_language_contracts.json",
                   json.dumps(registry))
            r = _with_project_root(root, _run_verifier)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("toOmo" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_pass_schema_mirror_when_fields_match(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            schema = {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {"a": {"type": "string"}, "b": {"type": "integer"}},
                "required": ["a"],
            }
            _write(root, "schemas/x.schema.json", json.dumps(schema))
            _write(root, "py/x.py", textwrap.dedent("""\
                from dataclasses import dataclass
                @dataclass
                class X:
                    a: str = ""
                    b: int = 0
            """))
            registry = {
                "schema_mirrors": [{
                    "name": "X",
                    "schema": "schemas/x.schema.json",
                    "dataclass_file": "py/x.py",
                    "dataclass_name": "X",
                }],
            }
            _write(root, "tools/HME/config/cross_language_contracts.json",
                   json.dumps(registry))
            r = _with_project_root(root, _run_verifier)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")

    def test_fail_schema_mirror_on_field_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            schema = {
                "type": "object",
                "properties": {"a": {"type": "string"}, "b": {"type": "integer"}, "c": {"type": "number"}},
            }
            _write(root, "schemas/x.schema.json", json.dumps(schema))
            _write(root, "py/x.py", textwrap.dedent("""\
                from dataclasses import dataclass
                @dataclass
                class X:
                    a: str = ""
                    d: float = 0.0
            """))
            registry = {
                "schema_mirrors": [{
                    "name": "X",
                    "schema": "schemas/x.schema.json",
                    "dataclass_file": "py/x.py",
                    "dataclass_name": "X",
                }],
            }
            _write(root, "tools/HME/config/cross_language_contracts.json",
                   json.dumps(registry))
            r = _with_project_root(root, _run_verifier)
            self.assertEqual(r.status, "FAIL")
            joined = " ".join(r.details)
            self.assertIn("schema_only", joined)
            self.assertIn("dataclass_only", joined)


if __name__ == "__main__":
    unittest.main()
