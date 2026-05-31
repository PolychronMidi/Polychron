#!/usr/bin/env python3
"""Smoke + class-shape tests for verify_coherence.runtime_behavior."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
os.environ.setdefault("PROJECT_ROOT", str(ROOT))
os.environ.setdefault("HME_METRICS_DIR", str(ROOT / "metrics"))
os.environ.setdefault("METRICS_DIR", str(ROOT / "metrics"))

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from helpers import assert_class_shape, smoke_run, with_project_root


def _classes():
    from verify_coherence.runtime_behavior import (
        TransientErrorFilterVerifier, ContextBudgetVerifier,
        WarmContextFreshnessVerifier, PlanOutputValidityVerifier,
        ServiceRegistryVerifier, ExplicitListTrackingRuleVerifier,
    )
    return (TransientErrorFilterVerifier, ContextBudgetVerifier, WarmContextFreshnessVerifier, PlanOutputValidityVerifier, ServiceRegistryVerifier, ExplicitListTrackingRuleVerifier)


class RuntimeBehaviorModuleTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        smoke_run(self, _classes())


class ContextBudgetBehaviourTests(unittest.TestCase):
    def test_uses_proxy_context_norm_when_hme_ctx_file_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ctx_path = root / "tools" / "HME" / "runtime" / "proxy-context-norm.json"
            ctx_path.parent.mkdir(parents=True)
            ctx_path.write_text(json.dumps({"used": 40, "size": 100, "remaining": 60}))
            prior = os.environ.pop("HME_CTX_FILE", None)
            try:
                def _run():
                    from verify_coherence.runtime_behavior import ContextBudgetVerifier
                    return ContextBudgetVerifier().run()
                result = with_project_root(root, _run)
            finally:
                if prior is not None:
                    os.environ["HME_CTX_FILE"] = prior
            self.assertEqual(result.status, "PASS")
            self.assertIn("40.0%", result.summary)

    def test_hme_ctx_file_still_takes_precedence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            explicit = root / "explicit-context.json"
            explicit.write_text(json.dumps({"used_pct": 30}))
            norm = root / "tools" / "HME" / "runtime" / "proxy-context-norm.json"
            norm.parent.mkdir(parents=True)
            norm.write_text(json.dumps({"used": 90, "size": 100, "remaining": 10}))
            prior = os.environ.get("HME_CTX_FILE")
            os.environ["HME_CTX_FILE"] = str(explicit)
            try:
                def _run():
                    from verify_coherence.runtime_behavior import ContextBudgetVerifier
                    return ContextBudgetVerifier().run()
                result = with_project_root(root, _run)
            finally:
                if prior is None:
                    os.environ.pop("HME_CTX_FILE", None)
                else:
                    os.environ["HME_CTX_FILE"] = prior
            self.assertEqual(result.status, "PASS")
            self.assertIn("30%", result.summary)


if __name__ == "__main__":
    unittest.main()
