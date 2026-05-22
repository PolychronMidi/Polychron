"""Repo hygiene coherence checks: canonical git hooks and shared policy."""
from __future__ import annotations

import os
import stat
from pathlib import Path

from ._base import Verifier, _result, PASS, FAIL, WARN, _PROJECT


class CanonicalPrecommitHookVerifier(Verifier):
    name = "canonical-precommit-hook"
    category = "repo-hygiene"
    subtag = "secret-prevention"
    weight = 1.0

    def run(self):
        root = Path(_PROJECT)
        policy = root / "tools" / "HME" / "config" / "repo-hygiene.json"
        canonical = root / "tools" / "HME" / "git-hooks" / "pre-commit"
        post_commit = root / "tools" / "HME" / "git-hooks" / "post-commit"
        validator = root / "tools" / "HME" / "scripts" / "precommit_validate.py"
        installer = root / "tools" / "HME" / "scripts" / "install-git-hooks.sh"
        installed = root / ".git" / "hooks" / "pre-commit"
        installed_post = root / ".git" / "hooks" / "post-commit"
        missing = [str(p.relative_to(root)) for p in (policy, canonical, post_commit, validator, installer) if not p.exists()]
        if missing:
            return _result(FAIL, 0.0, "repo hygiene precommit assets missing", missing)
        problems = []
        c_text = canonical.read_text(encoding="utf-8", errors="replace")
        pc_text = post_commit.read_text(encoding="utf-8", errors="replace")
        v_text = validator.read_text(encoding="utf-8", errors="replace")
        p_text = policy.read_text(encoding="utf-8", errors="replace")
        required = [
            "SECRETS ABOVE THIS LINE",
            "precommit_validate.py",
            "check-root-only-dirs.js",
        ]
        for token in required:
            if token not in c_text:
                problems.append(f"canonical hook missing token: {token}")
        for token in ["blocked_path_reason", "secret_hits", "has_conflict_markers", "executable_sanity"]:
            if token not in v_text:
                problems.append(f"validator missing token: {token}")
        for token in ["blocked_paths", "local_path_markers", "canonical_precommit", "canonical_post_commit"]:
            if token not in p_text:
                problems.append(f"policy missing token: {token}")
        for token in ["post-commit-proxy-reload-needed", "not restarting synchronously", "hme-errors.log", "stale_runtime", "GRACE_SEC", "post-commit-stale-runtime.json"]:
            if token not in pc_text:
                problems.append(f"canonical post-commit hook missing token: {token}")
        if "proxy-supervisor.sh" in pc_text:
            problems.append("canonical post-commit hook restarts proxy synchronously")
        if not (canonical.stat().st_mode & stat.S_IXUSR):
            problems.append("canonical hook is not executable")
        if not (post_commit.stat().st_mode & stat.S_IXUSR):
            problems.append("canonical post-commit hook is not executable")
        if not (validator.stat().st_mode & stat.S_IXUSR):
            problems.append("precommit validator is not executable")
        if not (installer.stat().st_mode & stat.S_IXUSR):
            problems.append("hook installer is not executable")
        if installed.exists():
            i_text = installed.read_text(encoding="utf-8", errors="replace")
            if i_text != c_text:
                problems.append("installed .git/hooks/pre-commit differs from canonical hook")
        else:
            return _result(WARN, 0.8, "canonical hook present but not installed", ["run tools/HME/scripts/install-git-hooks.sh"])
        if installed_post.exists():
            ip_text = installed_post.read_text(encoding="utf-8", errors="replace")
            if ip_text != pc_text:
                problems.append("installed .git/hooks/post-commit differs from canonical hook")
        else:
            return _result(WARN, 0.8, "canonical post-commit hook present but not installed", ["run tools/HME/scripts/install-git-hooks.sh"])
        if problems:
            return _result(FAIL, 0.0, "canonical precommit hook contract drift", problems)
        return _result(PASS, 1.0, "canonical pre/post-commit hooks installed; post-commit records reload-needed without hot restart")
