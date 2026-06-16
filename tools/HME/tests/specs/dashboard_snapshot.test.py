"""Regression tests for build-dashboard verifier snapshot fast path."""
from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
import specenv  # noqa: F401

ROOT = Path(__file__).resolve().parents[4]
SCRIPT = ROOT / "tools" / "HME" / "scripts" / "build-dashboard.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("_build_dashboard_under_test", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


class DashboardSnapshotTests(unittest.TestCase):
    def test_fresh_structured_snapshot_avoids_full_verifier_run(self):
        mod = _load_module()
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            snap = root / "src/output/metrics/hci-verifier-snapshot.json"
            snap.parent.mkdir(parents=True)
            snap.write_text(json.dumps({
                "ts": time.time(),
                "hci": 100.0,
                "verifier_count": 1,
                "categories": {"code": {"score": 1.0, "verifier_count": 1, "weight_total": 1.0}},
                "verifiers": {"unit": {"name": "unit", "category": "code", "status": "PASS", "score": 1.0}},
            }), encoding="utf-8")
            with mock.patch.object(mod, "_PROJECT", str(root)), \
                 mock.patch.object(mod, "_run_current_verifiers", side_effect=AssertionError("full verifier should not run")):
                report = mod._load_current_verifiers(refresh=False)
        self.assertEqual(report["source"], "hci-verifier-snapshot")
        self.assertEqual(report["verifiers"]["unit"]["name"], "unit")

    def test_explicit_refresh_runs_full_verifier(self):
        mod = _load_module()
        with mock.patch.object(mod, "_run_current_verifiers", return_value={"source": "verify-coherence.py --json"}):
            report = mod._load_current_verifiers(refresh=True)
        self.assertEqual(report["source"], "verify-coherence.py --json")


if __name__ == "__main__":
    unittest.main()
