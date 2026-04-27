"""Env + settings verifiers: settings.json, env-tamper, env-load, OAuth expiry."""
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


class SettingsJsonVerifier(Verifier):
    """~/.claude/settings.json is the entry point for every Claude Code
    hook. A malformed JSON edit breaks hook dispatch entirely on next
    session start — but the breakage is silent during the current
    session (hooks already registered stay registered). This verifier
    parses the file fresh on every HCI run and confirms the top-level
    shape matches what the hook stack depends on.

    Weight 2.0 — a broken settings.json silently disables every hook
    the next time Claude Code reads it."""
    name = "settings-json"
    category = "state"
    subtag = "interface-contract"
    weight = 2.0

    _REQUIRED_HOOK_EVENTS = {
        "SessionStart", "UserPromptSubmit", "PreToolUse",
        "PostToolUse", "Stop",
    }

    def run(self) -> VerdictResult:
        path = os.path.expanduser("~/.claude/settings.json")
        if not os.path.isfile(path):
            return _result(SKIP, 1.0, "no ~/.claude/settings.json")
        try:
            with open(path) as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            return _result(FAIL, 0.0,
                           f"settings.json is MALFORMED JSON: {e}",
                           [f"path: {path}",
                            "every hook is silently disabled on next session start"])
        except OSError as e:
            return _result(ERROR, 0.0, f"settings.json unreadable: {e}")

        issues = []

        if not isinstance(data, dict):
            return _result(FAIL, 0.0,
                           f"settings.json root is {type(data).__name__}, expected object")

        hooks = data.get("hooks")
        if hooks is None:
            issues.append("no 'hooks' key — all hooks are effectively disabled")
        elif not isinstance(hooks, dict):
            issues.append(f"'hooks' is {type(hooks).__name__}, expected object")
        else:
            missing_events = self._REQUIRED_HOOK_EVENTS - set(hooks.keys())
            if missing_events:
                issues.append(
                    f"missing lifecycle events: {sorted(missing_events)}"
                )
            # Every declared event must be a list of groups.
            for event, groups in hooks.items():
                if not isinstance(groups, list):
                    issues.append(f"hooks[{event!r}] is {type(groups).__name__}, expected list")
                    continue
                for i, group in enumerate(groups):
                    if not isinstance(group, dict):
                        issues.append(f"hooks[{event!r}][{i}] is {type(group).__name__}, expected object")
                        continue
                    ghooks = group.get("hooks")
                    if ghooks is None:
                        issues.append(f"hooks[{event!r}][{i}] missing 'hooks' key")
                        continue
                    if not isinstance(ghooks, list):
                        issues.append(f"hooks[{event!r}][{i}].hooks is {type(ghooks).__name__}, expected list")

        if issues:
            return _result(FAIL, 0.0,
                           f"{len(issues)} settings.json issue(s)",
                           issues)
        return _result(PASS, 1.0,
                       f"settings.json parses cleanly ({len(data.get('hooks', {}))} hook events declared)")


class OAuthTokenExpiryVerifier(Verifier):
    """~/.claude/.credentials.json holds the Claude Code OAuth token
    that the proxy's auth injection uses for OVERDRIVE_MODE and any
    other out-of-band Anthropic call. The token has an expiresAt field;
    when it's past, api.anthropic.com returns 401 and overdrive silently
    falls through to the free cascade with a logged warning.

    Claude Code itself refreshes the token while it's running, but if
    an MCP-server overdrive call fires while Claude Code happens to be
    between sessions (cold start, between rounds), the stale token
    causes a silent degradation. This verifier surfaces that class
    before it happens.

    Thresholds:
      - expired / absent      → FAIL (overdrive is dead)
      - <1h remaining         → WARN (refresh soon)
      - ≥1h remaining         → PASS

    Weight 1.0 — the degradation is graceful (cascade fallback), so
    this is informational, not catastrophic."""
    name = "oauth-token-expiry"
    category = "state"
    subtag = "freshness"
    weight = 1.0

    def run(self) -> VerdictResult:
        import time
        path = os.path.expanduser("~/.claude/.credentials.json")
        if not os.path.isfile(path):
            return _result(SKIP, 1.0,
                           "~/.claude/.credentials.json not present — overdrive disabled")
        try:
            with open(path) as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            return _result(FAIL, 0.0, f"credentials.json unreadable: {e}")
        oauth = data.get("claudeAiOauth") or {}
        expires_at = oauth.get("expiresAt")
        if not isinstance(expires_at, (int, float)):
            return _result(WARN, 0.5,
                           "claudeAiOauth.expiresAt missing/non-numeric — cannot verify",
                           [f"keys: {sorted(oauth.keys())}"])
        # expiresAt is milliseconds since epoch per Claude Code's format.
        now_ms = time.time() * 1000
        remaining_ms = expires_at - now_ms
        remaining_h = remaining_ms / 3_600_000
        if remaining_h <= 0:
            return _result(FAIL, 0.0,
                           f"OAuth token expired {-remaining_h:.1f}h ago — overdrive dead",
                           ["start Claude Code to trigger token refresh"])
        if remaining_h < 1:
            return _result(WARN, 0.5,
                           f"OAuth token expires in {remaining_h:.1f}h — refresh soon",
                           [f"remaining_ms={int(remaining_ms)}"])
        return _result(PASS, 1.0, f"OAuth token valid for {remaining_h:.1f}h")


class EnvTamperVerifier(Verifier):
    """Companion to EnvLoadVerifier. Compares the current .env contents
    against a stored SHA-256 checkpoint at .env.sha256. The first run
    writes the checkpoint; every subsequent run diffs against it and
    flags any change. The operator confirms legitimate changes by
    re-running `python3 tools/HME/scripts/verify-coherence.py
    --snapshot-env-sha` (or simply deleting .env.sha256 before the next
    run); unplanned drift surfaces as a FAIL.

    Weight 2.0 — silent .env mutation (rogue process, sloppy .env
    editor, merge conflict resolution) is a whole class of hard-to-
    debug failures. The verifier isn't cryptographic integrity — it's
    change-detection for ops confidence.
    """
    name = "env-tamper"
    category = "state"
    subtag = "regression-prevention"
    weight = 2.0

    def run(self) -> VerdictResult:
        import hashlib
        env_path = os.path.join(_PROJECT, ".env")
        sha_path = os.path.join(_PROJECT, ".env.sha256")
        if not os.path.isfile(env_path):
            return _result(SKIP, 1.0, ".env missing — EnvLoadVerifier flags this")
        try:
            with open(env_path, "rb") as f:
                current = hashlib.sha256(f.read()).hexdigest()
        except OSError as e:
            return _result(ERROR, 0.0, f".env unreadable: {e}")
        if not os.path.isfile(sha_path):
            # First run — establish baseline.
            try:
                with open(sha_path, "w") as f:
                    f.write(current + "\n")
            except OSError as e:
                return _result(WARN, 0.8,
                               f".env.sha256 could not be written: {e}",
                               [f"tamper detection inactive until {sha_path} exists"])
            return _result(PASS, 1.0,
                           f".env.sha256 baseline established ({current[:16]}...)")
        try:
            with open(sha_path) as f:
                stored = f.read().strip()
        except OSError as e:
            return _result(ERROR, 0.0, f".env.sha256 unreadable: {e}")
        if stored == current:
            return _result(PASS, 1.0, ".env matches baseline")
        return _result(FAIL, 0.0,
                       ".env content changed since last baseline",
                       [f"baseline: {stored[:16]}...",
                        f"current:  {current[:16]}...",
                        f"if intentional, `rm {sha_path}` and rerun to re-baseline"])


class EnvLoadVerifier(Verifier):
    """The .env file at the project root is the single source of
    PROJECT_ROOT, METRICS_DIR, HME_PROXY_PORT, and every other *HME_*
    setting the hook stack depends on. When .env fails to load,
    `_safety.sh` logs to stderr and _proxy_bridge drops stderr, and every
    hook downstream silently runs with PROJECT_ROOT="".

    This verifier catches that silent-failure class at its source:
    - .env must exist at $PROJECT/.env
    - PROJECT_ROOT must be declared and equal the detected project root
    - The file must be parseable by `set -a; source .env`

    Weight 3.0 — a broken .env makes every other verifier's diagnosis
    untrustworthy, so the score hit should be substantial."""
    name = "env-load"
    category = "state"
    subtag = "structural-integrity"
    weight = 3.0

    def run(self) -> VerdictResult:
        env_path = os.path.join(_PROJECT, ".env")
        if not os.path.isfile(env_path):
            return _result(FAIL, 0.0,
                           f".env missing at {env_path}",
                           [f"every downstream hook runs without PROJECT_ROOT — "
                            f"silent failure class"])

        # Parse the .env file manually — no `source` subshell, no shell
        # injection surface. KEY=VALUE per line, comments start with #,
        # blank lines ignored. Quoted values are accepted but the quotes
        # are not stripped (verifier is checking for the KEY's presence,
        # not value fidelity).
        declared = {}
        unparseable = []
        try:
            with open(env_path) as f:
                for line_no, line in enumerate(f, 1):
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" not in line:
                        unparseable.append(f"line {line_no}: {line[:80]!r}")
                        continue
                    key, value = line.split("=", 1)
                    key = key.strip()
                    if not key.replace("_", "").isalnum():
                        unparseable.append(f"line {line_no}: invalid key {key!r}")
                        continue
                    declared[key] = value.strip()
        except OSError as e:
            return _result(ERROR, 0.0, f".env unreadable: {e}")

        issues = []
        if unparseable:
            issues.extend(f"unparseable: {u}" for u in unparseable[:4])

        # Required keys the hook stack explicitly consults.
        required = ["PROJECT_ROOT"]
        for key in required:
            if key not in declared:
                issues.append(f"required key missing: {key}")

        # PROJECT_ROOT must reference the actual project root. The literal
        # string might use ${VAR} expansion; accept that but compare the
        # unquoted value's expected head.
        declared_root = declared.get("PROJECT_ROOT", "").strip('"').strip("'")
        if declared_root and declared_root != _PROJECT:
            issues.append(
                f"PROJECT_ROOT={declared_root!r} disagrees with detected root {_PROJECT!r}"
            )

        if issues:
            return _result(FAIL, 0.0,
                           f"{len(issues)} .env issue(s) — silent-failure class",
                           issues)
        return _result(PASS, 1.0,
                       f".env loads cleanly ({len(declared)} keys)")


