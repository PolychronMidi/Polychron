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

# Assemble the redirect-write line from parts so THIS test file's own source
# never matches the audit's `>> log/...` write regex (which would make the
_ROGUE_BODY = "#!/usr/bin/env bash\necho boom " + (">" * 2) + " log/hme-errors.log\n"


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


class StateOwnershipGateTests(unittest.TestCase):
    """The gate must be able to FAIL -- a verifier that can only pass is a
    coherence illusion. Asserts the audit is clean now and that an injected
    undeclared writer of a shared state file trips drift (rc=1)."""

    def test_clean_tree_passes(self):
        rc, out = _run_audit()
        self.assertEqual(rc, 0, f"expected clean audit, got rc={rc}\n{out}")

    def test_undeclared_writer_fails(self):
        rogue = _PROJECT / "tools" / "HME" / "hooks" / "pretooluse" / "_gate_test_rogue.sh"
        rogue.write_text(_ROGUE_BODY, encoding="utf-8")
        try:
            rc, out = _run_audit()
            self.assertEqual(rc, 1, f"undeclared writer must trip drift; got rc={rc}\n{out}")
            self.assertIn("_gate_test_rogue.sh", out)
        finally:
            rogue.unlink(missing_ok=True)

    def test_disabled_dir_is_ignored(self):
        d = _PROJECT / "tools" / "HME" / "hooks" / "pretooluse" / "bash" / "_disabled"
        d.mkdir(parents=True, exist_ok=True)
        rogue = d / "_gate_test_inert.sh"
        rogue.write_text(_ROGUE_BODY, encoding="utf-8")
        try:
            rc, out = _run_audit()
            self.assertEqual(rc, 0, f"_disabled writers must be ignored; got rc={rc}\n{out}")
        finally:
            rogue.unlink(missing_ok=True)
            try:
                d.rmdir()
            except OSError:
                pass  # silent-ok: pending review


if __name__ == "__main__":
    unittest.main()
