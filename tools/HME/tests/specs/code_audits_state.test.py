#!/usr/bin/env python3
"""Smoke + class-shape tests for verify_coherence.code_audits_state."""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from helpers import assert_class_shape, smoke_run

_PROJECT = Path(__file__).resolve().parents[4]
_AUDIT = _PROJECT / "tools" / "HME" / "scripts" / "audit-state-file-ownership.py"


def _run_audit():
    rc = subprocess.run(
        ["python3", str(_AUDIT)],
        capture_output=True, text=True, timeout=60,
        env={**os.environ, "PROJECT_ROOT": str(_PROJECT)},
    )
    return rc.returncode, rc.stdout


def _classes():
    from verify_coherence.code_audits_state import (
        StateFileOwnershipVerifier, ClaudeSettingsJsonVerifier,
        HumanDeferredAuditVerifier, ProxyMiddlewareRegistryVerifier,
        AdapterBoundaryRegistryVerifier, ToolMetadataFactoryVerifier,
        GeneratedISurfaceVerifier, InterControllerCoherenceVerifier,
        ShellHookAuditVerifier, ActivityEventsDocSyncVerifier,
    )
    return (StateFileOwnershipVerifier, ClaudeSettingsJsonVerifier, HumanDeferredAuditVerifier, ProxyMiddlewareRegistryVerifier, AdapterBoundaryRegistryVerifier, ToolMetadataFactoryVerifier, GeneratedISurfaceVerifier, InterControllerCoherenceVerifier, ShellHookAuditVerifier, ActivityEventsDocSyncVerifier)


class CodeAuditsStateModuleTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        smoke_run(self, _classes())


if __name__ == "__main__":
    unittest.main()
