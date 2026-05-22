#!/usr/bin/env python3
"""Unit tests for the metric-name-orphans verifier.

Run: python3 tools/HME/tests/specs/metric_name_orphans.test.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tools" / "HME" / "scripts"))


def _purge():
    for mod in list(sys.modules.keys()):
        if mod == "verify_coherence" or mod.startswith("verify_coherence."):
            sys.modules.pop(mod, None)


def _with_root(tmp: Path, fn):
    prior_pr = os.environ.get("PROJECT_ROOT")
    prior_m = os.environ.get("HME_METRICS_DIR")
    os.environ["PROJECT_ROOT"] = str(tmp)
    os.environ["HME_METRICS_DIR"] = str(tmp / "metrics")
    _purge()
    try:
        return fn()
    finally:
        if prior_pr is None: os.environ.pop("PROJECT_ROOT", None)
        else: os.environ["PROJECT_ROOT"] = prior_pr
        if prior_m is None: os.environ.pop("HME_METRICS_DIR", None)
        else: os.environ["HME_METRICS_DIR"] = prior_m
        _purge()


def _init_git_repo(root: Path) -> None:
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                    "config", "user.email", "t@t"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=root, check=True)


def _stage(root: Path, rel: str, content: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    subprocess.run(["git", "add", rel], cwd=root, check=True)


def _write_registry(root: Path, metric_sets: dict) -> None:
    registry = {
        "shared_sets": [
            {"name": name, "values": values, "sites": []}
            for name, values in metric_sets.items()
        ],
        "function_pairs": [],
        "schema_mirrors": [],
    }
    _stage(root, "tools/HME/config/cross_language_contracts.json",
           json.dumps(registry))


def _stage_declarations(root: Path) -> None:
    """Declarations referencing every name; must be ignored as writers."""
    _stage(root, "tools/HME/scripts/hme_paths.py",
           "# declarations only\n")
    _stage(root, "tools/HME/proxy/hme_paths.js",
           "// declarations only\n")


def _run():
    from verify_coherence.metric_name_orphans import MetricNameOrphansVerifier
    return MetricNameOrphansVerifier().run()


class MetricNameOrphansTests(unittest.TestCase):
    def test_skip_when_registry_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_git_repo(root)
            r = _with_root(root, _run)
            self.assertEqual(r.status, "SKIP", msg=f"summary={r.summary}")

    def test_skip_when_no_metric_name_sets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_git_repo(root)
            _stage(root, "tools/HME/config/cross_language_contracts.json",
                   json.dumps({"shared_sets": [
                       {"name": "OTHER_SET", "values": ["x"], "sites": []},
                   ]}))
            r = _with_root(root, _run)
            self.assertEqual(r.status, "SKIP", msg=f"summary={r.summary}")

    def test_pass_when_every_name_has_a_writer(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_git_repo(root)
            _write_registry(root, {"PROJECT_METRIC_NAMES": ["alpha.json", "bravo.json"]})
            _stage_declarations(root)
            _stage(root, "src/alpha_writer.py",
                   'open("alpha.json", "w")\n')
            _stage(root, "src/bravo_writer.js",
                   "fs.writeFileSync('bravo.json', '');\n")
            r = _with_root(root, _run)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")

    def test_fail_when_name_is_orphaned(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_git_repo(root)
            _write_registry(root, {"HME_METRIC_NAMES": ["alpha.json", "orphan.jsonl"]})
            _stage_declarations(root)
            _stage(root, "src/alpha_writer.py", 'open("alpha.json", "w")\n')
            r = _with_root(root, _run)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("orphan.jsonl" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_declaration_sites_do_not_count_as_writers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_git_repo(root)
            _write_registry(root, {"PROJECT_METRIC_NAMES": ["only-in-decl.json"]})
            _stage(root, "tools/HME/scripts/hme_paths.py",
                   'PROJECT_METRIC_NAMES = {"only-in-decl.json"}\n')
            _stage(root, "tools/HME/proxy/hme_paths.js",
                   "const PROJECT_METRIC_NAMES = new Set(['only-in-decl.json']);\n")
            r = _with_root(root, _run)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("only-in-decl.json" in d for d in r.details),
                            msg=f"details={r.details}")


if __name__ == "__main__":
    unittest.main()
