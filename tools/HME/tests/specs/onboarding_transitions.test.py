#!/usr/bin/env python3
"""Regression tests for the onboarding transition-coverage guard.

Pins the bug class that stranded a fresh agent at `targeted`: a forward edge
in the onboarding state machine with no live advancer. Two layers under test:

  1. audit-onboarding-transitions.py -- run against synthetic project trees;
     a complete advancer set PASSes, a removed advancer FAILs naming the dead
     edge. This is the detector the manual "delete advancer, watch FAIL"
     check proved by hand -- now permanent.
  2. OnboardingTransitionsVerifier -- the HCI wrapper must FAIL on a dead edge
     (gating, no advisory swallow) and PASS only when every edge is covered.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from helpers import assert_class_shape, smoke_run  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[4]
AUDIT = REPO_ROOT / "tools" / "HME" / "scripts" / "audit-onboarding-transitions.py"

# Minimal 4-state machine: boot is armed externally; selftest_ok via python
# set_state; targeted via shell advancer; edited via shell advancer.
_STATES = ["boot", "selftest_ok", "targeted", "edited"]

_DISPATCH = '''def _advance():
    set_state("selftest_ok")
    set_state("targeted")
'''

_HOOK_FULL = '''#!/usr/bin/env bash
_onb_advance_to edited
'''


def _build_tree(root: Path, *, with_edited_advancer: bool) -> None:
    cfg = root / "tools" / "HME" / "config"
    cfg.mkdir(parents=True, exist_ok=True)
    (cfg / "onboarding_states.json").write_text(json.dumps({"states": _STATES}))

    server = root / "tools" / "HME" / "service" / "server"
    server.mkdir(parents=True, exist_ok=True)
    (server / "onboarding_chain_dispatch.py").write_text(_DISPATCH)

    hooks = root / "tools" / "HME" / "hooks" / "posttooluse"
    hooks.mkdir(parents=True, exist_ok=True)
    body = _HOOK_FULL if with_edited_advancer else "#!/usr/bin/env bash\n: noop\n"
    (hooks / "posttooluse_edit.sh").write_text(body)


def _run_audit(root: Path) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["PROJECT_ROOT"] = str(root)
    return subprocess.run(
        [sys.executable, str(AUDIT)],
        capture_output=True, text=True, env=env,
    )


class AuditDetectorTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_complete_machine_passes(self):
        _build_tree(self.root, with_edited_advancer=True)
        r = _run_audit(self.root)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("PASS", r.stdout)

    def test_dead_edge_fails_and_names_it(self):
        _build_tree(self.root, with_edited_advancer=False)
        r = _run_audit(self.root)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("DEAD-EDGE: targeted -> edited", r.stdout)

    def test_real_repo_machine_is_covered(self):
        # The live project tree must have zero dead edges -- this is the guard
        # that would have caught the original targeted->edited gap at rest.
        r = _run_audit(REPO_ROOT)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


class VerifierGateTests(unittest.TestCase):
    def _verifier(self):
        from verify_coherence.code_audits_state import OnboardingTransitionsVerifier
        return OnboardingTransitionsVerifier()

    def test_class_shape(self):
        from verify_coherence.code_audits_state import OnboardingTransitionsVerifier
        assert_class_shape(self, OnboardingTransitionsVerifier)

    def test_smoke_run(self):
        from verify_coherence.code_audits_state import OnboardingTransitionsVerifier
        smoke_run(self, (OnboardingTransitionsVerifier,))

    def test_dead_edge_fails_gate(self):
        import verify_coherence.code_audits_state as mod
        orig = mod._run_subprocess
        mod._run_subprocess = lambda *a, **k: (
            1,
            "audit-onboarding-transitions: FAIL (1 dead transition(s))\n"
            "  DEAD-EDGE: targeted -> edited",
            "",
        )
        try:
            r = self._verifier().run()
            self.assertEqual(r.status, "FAIL", r.summary)
            self.assertIn("1 dead", r.summary)
        finally:
            mod._run_subprocess = orig

    def test_covered_machine_passes_gate(self):
        import verify_coherence.code_audits_state as mod
        orig = mod._run_subprocess
        mod._run_subprocess = lambda *a, **k: (0, "audit-onboarding-transitions: PASS", "")
        try:
            r = self._verifier().run()
            self.assertEqual(r.status, "PASS", r.summary)
        finally:
            mod._run_subprocess = orig


if __name__ == "__main__":
    unittest.main()
