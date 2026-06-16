#!/usr/bin/env python3
"""Regression tests for memetic-drift's recent-evidence contract."""
from __future__ import annotations

import importlib.util
import os
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
import specenv  # noqa: F401

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "tools" / "HME" / "scripts" / "memetic-drift.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("_memetic_drift_under_test", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


class MemeticDriftWindowTests(unittest.TestCase):
    def test_recent_error_lines_excludes_historical_scar_tissue(self):
        mod = _load_module()
        now = time.time()
        fresh = datetime.fromtimestamp(now - 60, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        old = datetime.fromtimestamp(now - 3 * 24 * 60 * 60, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "hme-errors.log"
            p.write_text(
                f"[{old}] review should not count after old change\n"
                f"[{fresh}] review should count after fresh change\n",
                encoding="utf-8",
            )
            with mock.patch.object(mod, "_RECENT_WINDOW_SEC", 24 * 60 * 60):
                rows = mod._recent_error_lines(str(p))
        self.assertEqual(len(rows), 1)
        self.assertIn("fresh change", rows[0])

    def test_analyze_report_declares_recent_evidence_scope(self):
        mod = _load_module()
        with mock.patch.object(mod, "_extract_rules", return_value=[]), \
             mock.patch.object(mod, "_violation_count", return_value={"review = read-only": 1}):
            report = mod.analyze()
        self.assertEqual(report["evidence_scope"], "recent")
        self.assertGreater(report["window_sec"], 0)
        self.assertLess(report["cutoff_ts"], report["generated_at"])
        self.assertEqual(report["violation_counts"], {"review = read-only": 1})


if __name__ == "__main__":
    unittest.main()
