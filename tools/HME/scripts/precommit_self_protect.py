"""Pre-commit hook self-protection checks."""
from __future__ import annotations

import stat
from pathlib import Path
from typing import Any


def self_protect_failures(
    root: Path,
    policy: dict[str, Any],
    hook_path: Path,
    post_commit_hook_path: Path,
    marker: str,
) -> list[str]:
    failures: list[str] = []
    canonical = root / policy.get("canonical_precommit", "tools/HME/git-hooks/pre-commit")
    post_commit = root / policy.get("canonical_post_commit", "tools/HME/git-hooks/post-commit")
    validator = root / policy.get("precommit_validator", "tools/HME/scripts/precommit_validate.py")
    for label, path in (("pre-commit", canonical), ("post-commit", post_commit), ("pre-commit", validator)):
        if not path.is_file():
            failures.append(f"{label} self-protection failed: canonical hook missing")
    try:
        hook_text = hook_path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        failures.append(f"pre-commit self-protection failed: cannot read hook ({exc.__class__.__name__})")
        return failures
    missing = [token for token in (marker, "precommit_validate.py") if token not in hook_text]
    if missing:
        failures.append("pre-commit self-protection failed: hook lost guard token(s): " + ", ".join(missing))
    if canonical.is_file() and hook_text != canonical.read_text(encoding="utf-8", errors="replace"):
        failures.append("pre-commit self-protection failed: installed hook differs from canonical tools/HME/git-hooks/pre-commit")
    if post_commit.is_file():
        try:
            post_text = post_commit.read_text(encoding="utf-8", errors="replace")
            installed = post_commit_hook_path.read_text(encoding="utf-8", errors="replace")
            if installed != post_text:
                failures.append("post-commit self-protection failed: installed hook differs from canonical tools/HME/git-hooks/post-commit")
            for token in ("post-commit-proxy-reload-needed", "not restarting synchronously"):
                if token not in post_text:
                    failures.append(f"post-commit self-protection failed: canonical hook missing token: {token}")
        except OSError as exc:
            failures.append(f"post-commit self-protection failed: cannot read installed hook ({exc.__class__.__name__})")
    for label, path in (("pre-commit", hook_path), ("post-commit", post_commit_hook_path)):
        try:
            if not (path.stat().st_mode & stat.S_IXUSR):
                failures.append(f"{label} self-protection failed: hook is not executable")
        except OSError:
            pass  # silent-ok: pending review
    return failures
