#!/usr/bin/env python3
"""Unit tests for the canonical-precommit-hook verifier.

Run: python3 tools/HME/tests/specs/repo_hygiene.test.py
"""
from __future__ import annotations

import os
import shutil
import stat
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tools" / "HME" / "scripts"))


CANONICAL_HOOK = (
    "#!/bin/bash\n"
    "# canonical pre-commit hook\n"
    "python3 tools/HME/scripts/precommit_validate.py\n"
    "node tools/HME/scripts/check-root-only-dirs.js\n"
    "# SECRETS ABOVE THIS LINE\n"
)
CANONICAL_POST = (
    "#!/bin/bash\n"
    "# canonical post-commit hook\n"
    "GRACE_SEC=5\n"
    "echo not restarting synchronously\n"
    "echo hme-errors.log\n"
    "echo stale_runtime\n"
    "echo post-commit-proxy-reload-needed\n"
    "echo post-commit-stale-runtime.json\n"
)
VALIDATOR_STUB = (
    "#!/usr/bin/env python3\n"
    "# blocked_path_reason\n"
    "# secret_hits\n"
    "# has_conflict_markers\n"
    "# executable_sanity\n"
)
POLICY_STUB = (
    "{\n"
    '  "blocked_paths": [],\n'
    '  "local_path_markers": [],\n'
    '  "canonical_precommit": "tools/HME/git-hooks/pre-commit",\n'
    '  "canonical_post_commit": "tools/HME/git-hooks/post-commit"\n'
    "}\n"
)
INSTALLER_STUB = "#!/bin/bash\necho install hook\n"


def _set_executable(path: Path) -> None:
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _write(root: Path, rel: str, body: str, executable: bool = False) -> Path:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body)
    if executable:
        _set_executable(p)
    return p


def _scaffold_repo(root: Path, install_hooks: bool = True) -> None:
    _write(root, "tools/HME/config/repo-hygiene.json", POLICY_STUB)
    _write(root, "tools/HME/git-hooks/pre-commit", CANONICAL_HOOK, executable=True)
    _write(root, "tools/HME/git-hooks/post-commit", CANONICAL_POST, executable=True)
    _write(root, "tools/HME/scripts/precommit_validate.py", VALIDATOR_STUB, executable=True)
    _write(root, "tools/HME/scripts/install-git-hooks.sh", INSTALLER_STUB, executable=True)
    if install_hooks:
        _write(root, ".git/hooks/pre-commit", CANONICAL_HOOK, executable=True)
        _write(root, ".git/hooks/post-commit", CANONICAL_POST, executable=True)


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


def _run():
    from verify_coherence.repo_hygiene import CanonicalPrecommitHookVerifier
    return CanonicalPrecommitHookVerifier().run()


class CanonicalPrecommitHookTests(unittest.TestCase):
    def test_pass_when_hooks_installed_and_match_canonical(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _scaffold_repo(root)
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "PASS", msg=f"summary={r.summary} details={r.details}")
            self.assertEqual(r.score, 1.0)

    def test_fail_when_required_token_missing_from_canonical_hook(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _scaffold_repo(root)
            (root / "tools/HME/git-hooks/pre-commit").write_text(
                "#!/bin/bash\n# no required tokens here\n"
            )
            _set_executable(root / "tools/HME/git-hooks/pre-commit")
            shutil.copy(root / "tools/HME/git-hooks/pre-commit",
                        root / ".git/hooks/pre-commit")
            _set_executable(root / ".git/hooks/pre-commit")
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("SECRETS ABOVE THIS LINE" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_warn_when_canonical_hook_not_installed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _scaffold_repo(root, install_hooks=False)
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "WARN", msg=f"summary={r.summary}")
            self.assertTrue(any("install-git-hooks" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_fail_when_installed_hook_drifts_from_canonical(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _scaffold_repo(root)
            (root / ".git/hooks/pre-commit").write_text(
                CANONICAL_HOOK + "# drifted local edit\n"
            )
            _set_executable(root / ".git/hooks/pre-commit")
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("differs from canonical" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_fail_when_post_commit_restarts_proxy_synchronously(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _scaffold_repo(root)
            (root / "tools/HME/git-hooks/post-commit").write_text(
                CANONICAL_POST + "bash tools/HME/launcher/proxy-supervisor.sh\n"
            )
            _set_executable(root / "tools/HME/git-hooks/post-commit")
            shutil.copy(root / "tools/HME/git-hooks/post-commit",
                        root / ".git/hooks/post-commit")
            _set_executable(root / ".git/hooks/post-commit")
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL")
            self.assertTrue(any("restarts proxy synchronously" in d for d in r.details),
                            msg=f"details={r.details}")

    def test_fail_when_canonical_assets_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root, "tools/HME/config/repo-hygiene.json", POLICY_STUB)
            r = _with_project_root(root, _run)
            self.assertEqual(r.status, "FAIL")
            self.assertEqual(r.score, 0.0)


if __name__ == "__main__":
    unittest.main()
