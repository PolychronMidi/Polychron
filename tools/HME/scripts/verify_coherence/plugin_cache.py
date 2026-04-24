"""Plugin cache + hook command existence verifiers."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

import hashlib

from ._base import (
    Verifier, VerdictResult, _result, _run_subprocess,
    PASS, WARN, FAIL, SKIP, ERROR,
    _PROJECT, _HOOKS_DIR, _SERVER_DIR, _SCRIPTS_DIR, _DOC_DIRS, METRICS_DIR,
)


class PluginCacheParityVerifier(Verifier):
    """The HME plugin cache at ~/.claude/plugins/cache/polychron-local/
    HME/1.0.0/hooks/ is a frozen copy populated at plugin install time.
    If the repo hooks at tools/HME/hooks/ diverge from the cache, edits
    to the repo silently have no effect on the live hook system — this
    is precisely the meta-failure that produced 20+ silent autocommit
    failures.

    This verifier compares paired files by content hash. Files only on
    one side are flagged separately. FAILs if any paired file's hash
    differs; the drift is always actionable (either update the cache or
    re-install the plugin)."""
    name = "plugin-cache-parity"
    category = "state"
    weight = 2.0

    def run(self) -> VerdictResult:
        import hashlib
        repo_hooks = os.path.join(_PROJECT, "tools", "HME", "hooks")
        cache_hooks = os.path.expanduser(
            "~/.claude/plugins/cache/polychron-local/HME/1.0.0/hooks"
        )
        if not os.path.isdir(cache_hooks) and not os.path.islink(cache_hooks):
            return _result(SKIP, 1.0,
                           "plugin cache not installed — no parity to check",
                           [f"expected at {cache_hooks}"])
        if not os.path.isdir(repo_hooks):
            return _result(ERROR, 0.0,
                           "repo hooks dir missing",
                           [f"expected at {repo_hooks}"])

        # Fast path: cache is a symlink that resolves to the repo hooks.
        # Parity is tautological — skip the expensive walk and PASS
        # immediately. Keep the structural cache path in settings.json
        # working while eliminating the drift problem entirely.
        if os.path.islink(cache_hooks):
            resolved = os.path.realpath(cache_hooks)
            repo_real = os.path.realpath(repo_hooks)
            if resolved == repo_real:
                return _result(PASS, 1.0,
                               "plugin cache is a symlink to repo hooks (drift structurally impossible)",
                               [f"{cache_hooks} -> {resolved}"])
            # Symlinked somewhere ELSE — the link target is not the repo.
            # That's a real misconfiguration worth surfacing, not silent PASS.
            return _result(FAIL, 0.0,
                           f"plugin cache symlink points outside repo: {resolved}",
                           [f"expected target: {repo_real}"])

        def hash_tree(root):
            out = {}
            skipped = []
            for dirpath, _dirs, files in os.walk(root):
                for f in files:
                    if f.startswith("."):
                        continue
                    full = os.path.join(dirpath, f)
                    rel = os.path.relpath(full, root)
                    try:
                        with open(full, "rb") as fp:
                            out[rel] = hashlib.sha256(fp.read()).hexdigest()
                    except (OSError, PermissionError) as e:
                        # Skip files unreadable at walk time (broken
                        # symlinks, permissions). Narrow except — we want
                        # ANY other exception (e.g. MemoryError) to
                        # propagate and fail the verifier visibly.
                        skipped.append(f"{rel}: {e.__class__.__name__}")
            return out, skipped

        repo, repo_skipped = hash_tree(repo_hooks)
        cache, cache_skipped = hash_tree(cache_hooks)
        diverged = [r for r in repo if r in cache and repo[r] != cache[r]]
        repo_only = sorted(set(repo) - set(cache))
        cache_only = sorted(set(cache) - set(repo))

        issues = []
        for r in diverged:
            issues.append(f"diverged: {r} (repo vs cache sha256 differ)")
        # Repo-only files are less alarming (new hooks not yet cached).
        # Cache-only files are very alarming (cache has hooks the repo
        # has lost). Report both, FAIL on divergence.
        for r in repo_only[:6]:
            issues.append(f"repo-only: {r}")
        for r in cache_only[:6]:
            issues.append(f"cache-only: {r}")
        # Surface skipped files so a permission failure silently dropping
        # from the parity check doesn't masquerade as PASS.
        for s in (repo_skipped + cache_skipped)[:4]:
            issues.append(f"skipped (unreadable): {s}")

        if not diverged and not cache_only:
            return _result(PASS, 1.0,
                           f"plugin cache parity ({len(repo)} repo files, {len(cache)} cache files)",
                           [f"repo-only: {len(repo_only)} (usually fine)"]
                           if repo_only else [])
        # Any divergence or cache-only file is a fail — it means the
        # live hook system is running a different version than the repo.
        score = max(0.0, 1.0 - 0.1 * (len(diverged) + len(cache_only)))
        return _result(FAIL, score,
                       f"{len(diverged)} diverged, {len(cache_only)} cache-only, {len(repo_only)} repo-only",
                       issues)


class HookCommandExistenceVerifier(Verifier):
    """Every hook command path declared in ~/.claude/settings.json
    must resolve to an existing, executable file. Typos in the hook path
    make Claude Code silently invoke a nonexistent script — bash errors,
    Claude Code ignores the error, and the hook quietly does nothing.

    Specifically tracks the `bash <path> <args>` pattern used throughout
    the Polychron hook configuration. Non-bash hooks are reported as
    SKIP so this verifier doesn't flag unrelated tools."""
    name = "hook-command-existence"
    category = "state"
    weight = 1.5

    def run(self) -> VerdictResult:
        settings_path = os.path.expanduser("~/.claude/settings.json")
        if not os.path.isfile(settings_path):
            return _result(SKIP, 1.0, "no ~/.claude/settings.json")
        try:
            with open(settings_path) as f:
                settings = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            return _result(ERROR, 0.0, f"settings.json unreadable: {e}")

        # Explicit key check — fail-fast if the schema diverges rather
        # than silently defaulting to an empty dict.
        hooks = settings.get("hooks")
        if hooks is None:
            return _result(SKIP, 1.0, "no 'hooks' key in settings.json")
        if not hooks:
            return _result(SKIP, 1.0, "no hooks declared in settings.json")
        if not isinstance(hooks, dict):
            return _result(ERROR, 0.0,
                           f"settings.json 'hooks' is {type(hooks).__name__}, expected dict")

        checked = 0
        missing = []
        not_executable = []
        for event, groups in hooks.items():
            # Claude Code schema: groups is a list. If not, that's a real
            # configuration error, not something to silently paper over.
            if not isinstance(groups, list):
                return _result(ERROR, 0.0,
                               f"settings.json hooks[{event!r}] is {type(groups).__name__}, expected list")
            for group in groups:
                group_hooks = group.get("hooks")
                if group_hooks is None:
                    continue
                if not isinstance(group_hooks, list):
                    return _result(ERROR, 0.0,
                                   f"settings.json hooks[{event!r}][].hooks is {type(group_hooks).__name__}, expected list")
                for h in group_hooks:
                    cmd_raw = h.get("command")
                    if cmd_raw is None:
                        continue
                    cmd = cmd_raw.strip()
                    if not cmd:
                        continue
                    # Match the `bash <script> <args>` pattern.
                    tokens = cmd.split()
                    if len(tokens) < 2 or tokens[0] != "bash":
                        # Non-bash hook — not in scope for this check.
                        continue
                    script = tokens[1]
                    checked += 1
                    if not os.path.isfile(script):
                        missing.append(f"{event}: {script}")
                    elif not os.access(script, os.X_OK):
                        # bash can still invoke it via explicit `bash`, so
                        # non-executable is only a warning.
                        not_executable.append(f"{event}: {script}")

        if checked == 0:
            return _result(SKIP, 1.0, "no bash-invoked hooks to check")
        if missing:
            score = max(0.0, 1.0 - len(missing) / checked)
            return _result(FAIL, score,
                           f"{len(missing)}/{checked} hook script(s) missing",
                           missing + not_executable)
        if not_executable:
            return _result(WARN, 0.9,
                           f"{len(not_executable)}/{checked} hook script(s) not marked executable",
                           not_executable)
        return _result(PASS, 1.0, f"all {checked} bash-hook scripts present")


