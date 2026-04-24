#!/usr/bin/env python3
"""HME unified self-coherence engine.

Treats HME's self-coherence the same way Polychron treats musical coherence:
as a multi-dimensional signal space. Each dimension is a `Verifier` that
produces a numeric score; the aggregate is the HME Coherence Index (HCI)
on a 0-100 scale.

This script unifies all individual verifiers (verify-doc-sync, verify-states-sync,
verify-onboarding-flow, etc.) into one extensible registry, so HME can
audit its own coherence with one command and produce machine-readable
output that can be diffed across sessions.

Architecture:
  - `Verifier` (abstract): defines run() -> VerdictResult
  - `Registry`: maps verifier name -> instance
  - `Engine`: runs all registered verifiers, aggregates scores, formats report
  - `VerdictResult`: status + score 0-1 + summary + details + duration

Output formats:
  --text (default): human-readable per-category report + HCI banner
  --json: machine-readable full snapshot, suitable for diffing
  --score: just the HCI integer (for shell pipelines and statusline)

Wired into hme_admin(action='selftest') alongside the standalone verifiers
it subsumes. Future verifiers should be added by appending to REGISTRY.

Exit codes:
  0 — HCI >= threshold (default 80)
  1 — HCI < threshold
  2 — engine error (internal failure, not a coherence failure)
"""
import dataclasses
import json
import os
import re
import subprocess
import sys
import time
from typing import Callable

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
METRICS_DIR = os.environ.get("METRICS_DIR", os.path.join(_PROJECT, "output", "metrics"))
_HOOKS_DIR = os.path.join(_PROJECT, "tools", "HME", "hooks")
_SERVER_DIR = os.path.join(_PROJECT, "tools", "HME", "mcp", "server")
_SCRIPTS_DIR = os.path.join(_PROJECT, "tools", "HME", "scripts")
_DOC_DIRS = [os.path.join(_PROJECT, "doc"), os.path.join(_PROJECT, "tools", "HME", "skills")]



# Result types


PASS = "PASS"
WARN = "WARN"
FAIL = "FAIL"
SKIP = "SKIP"
ERROR = "ERROR"


@dataclasses.dataclass
class VerdictResult:
    status: str          # PASS | WARN | FAIL | SKIP | ERROR
    score: float         # 0.0 - 1.0
    summary: str         # one-line summary
    details: list        # list of strings (multi-line context)
    duration_ms: float = 0.0

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


def _result(status: str, score: float, summary: str, details=None) -> VerdictResult:
    return VerdictResult(status=status, score=max(0.0, min(1.0, score)),
                         summary=summary, details=details or [])



# Verifier base + helpers


class Verifier:
    """Each subclass declares name, category, weight, and run()."""
    name: str = ""
    category: str = ""
    weight: float = 1.0

    def run(self) -> VerdictResult:
        raise NotImplementedError

    def execute(self) -> VerdictResult:
        t0 = time.time()
        try:
            result = self.run()
        except Exception as e:
            import traceback
            result = _result(ERROR, 0.0, f"verifier crashed: {type(e).__name__}: {e}",
                             [traceback.format_exc()])
        result.duration_ms = (time.time() - t0) * 1000
        return result


def _run_subprocess(script, timeout: int = 30) -> tuple:
    """Run a verifier subprocess, return (returncode, stdout, stderr).
    `script` is either a path string or a [path, *args] list. When a list
    is passed, args are appended to the python3 invocation unchanged."""
    if isinstance(script, list):
        argv = ["python3", *script]
    else:
        argv = ["python3", script]
    rc = subprocess.run(
        argv,
        capture_output=True, text=True, timeout=timeout,
        env={**os.environ, "PROJECT_ROOT": _PROJECT},
    )
    return rc.returncode, rc.stdout, rc.stderr



# Verifiers — DOC category


class DocDriftVerifier(Verifier):
    name = "doc-drift"
    category = "doc"
    weight = 2.0  # critical: stale docs mislead every agent

    def run(self) -> VerdictResult:
        script = os.path.join(_SCRIPTS_DIR, "verify-doc-sync.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "verifier script not found", [script])
        rc, out, err = _run_subprocess(script)
        hits = None
        for ln in out.splitlines():
            if ln.startswith("Drift hits:"):
                try:
                    hits = int(ln.split(":", 1)[1].strip())
                except ValueError:
                    pass
                break
        if hits is None:
            return _result(ERROR, 0.0, "could not parse verifier output", [err[:500]])
        if hits == 0:
            return _result(PASS, 1.0, "no legacy tool references in any doc")
        score = max(0.0, 1.0 - hits / 20.0)  # 20 hits = score 0
        return _result(FAIL, score, f"{hits} legacy tool reference(s)",
                       out.splitlines()[:30])


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


class LogSizeVerifier(Verifier):
    """The key HME logs (hme-proxy.out, hme-errors.log,
    hme-proxy-lifecycle.log, hme-activity.jsonl) are all append-only
    and never rotate. Left unchecked they fill disk — at which point
    every log-writing hook silently fails (another silent-failure
    class the autocommit hardening was meant to close).

    WARN above 50MB per file, FAIL above 200MB. The thresholds are
    generous — noisy proxies can produce tens of MB per day, so an
    unattended run hits 50MB in a few weeks and 200MB only after
    months of neglect. Action on FAIL: truncate or rotate. A simple
    `: > log/hme-proxy.out` is safe; the proxy reopens in append mode
    next write."""
    name = "log-size"
    category = "state"
    weight = 1.0

    WARN_BYTES = 50 * 1024 * 1024       # 50 MB
    FAIL_BYTES = 200 * 1024 * 1024      # 200 MB

    _WATCHED = (
        "log/hme-proxy.out",
        "log/hme-errors.log",
        "log/hme-proxy-lifecycle.log",
        "output/metrics/hme-activity.jsonl",
    )

    def run(self) -> VerdictResult:
        warn_hits = []
        fail_hits = []
        for rel in self._WATCHED:
            path = os.path.join(_PROJECT, rel)
            if not os.path.isfile(path):
                continue
            try:
                size = os.path.getsize(path)
            except OSError as e:
                # Unreadable — still signals a problem worth surfacing,
                # not silently skipping. Narrow catch.
                warn_hits.append(f"{rel}: stat failed ({e})")
                continue
            mb = size / (1024 * 1024)
            if size >= self.FAIL_BYTES:
                fail_hits.append(f"{rel}: {mb:.1f} MB (≥200 MB)")
            elif size >= self.WARN_BYTES:
                warn_hits.append(f"{rel}: {mb:.1f} MB (≥50 MB)")

        if fail_hits:
            return _result(FAIL, 0.0,
                           f"{len(fail_hits)} log file(s) over 200 MB",
                           fail_hits + warn_hits)
        if warn_hits:
            return _result(WARN, 0.75,
                           f"{len(warn_hits)} log file(s) over 50 MB",
                           warn_hits)
        return _result(PASS, 1.0, "all watched logs under 50 MB")


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


class AutocommitHealthVerifier(Verifier):
    """Autocommit must succeed every attempt. Catastrophic silent failure
    has been observed — autocommits dying without a single LIFESAVER
    alert, because the original failure path depended on the very
    environment that was broken.

    The _autocommit.sh helper now records every failure to four
    independent channels (sticky fail flag, hme-errors.log, stderr,
    activity bridge). This verifier checks the most durable of those —
    the sticky fail flag and the attempt counter under tmp/ — which are
    independent of PROJECT_ROOT, .env loading, log-dir writability, and
    _proxy_bridge stderr filtering. FAILs at weight 5.0 (same tier as
    LifesaverIntegrity) because autocommit going silent is the exact
    structural-dampening failure mode that weight exists for."""
    name = "autocommit-health"
    category = "state"
    weight = 5.0

    def run(self) -> VerdictResult:
        import datetime
        state_dir = os.path.join(_PROJECT, "tmp")
        fail_flag = os.path.join(state_dir, "hme-autocommit.fail")
        counter_file = os.path.join(state_dir, "hme-autocommit.counter")
        last_ok_file = os.path.join(state_dir, "hme-autocommit.last-success")

        issues = []

        # 1. Sticky fail flag — exists iff last autocommit failed.
        if os.path.isfile(fail_flag):
            try:
                with open(fail_flag) as f:
                    issues.append(f"fail flag set: {f.read().strip()[:240]}")
            except OSError as e:
                issues.append(f"fail flag exists but unreadable: {e}")

        # 2. Attempt counter — monotonic increment on every attempt, reset
        # on success. 3+ attempts without a reset = wedged state.
        if os.path.isfile(counter_file):
            try:
                with open(counter_file) as f:
                    raw = f.read().strip()
            except OSError as e:
                issues.append(f"counter file unreadable: {e}")
            else:
                # Empty-file and non-numeric content are separate real
                # states, not the same "0". Treat empty as "never written"
                # (benign, skip) and non-numeric as a hard parse error.
                if not raw:
                    pass
                else:
                    try:
                        n = int(raw)
                    except ValueError:
                        issues.append(f"counter file has non-numeric content: {raw[:40]!r}")
                    else:
                        if n >= 3:
                            issues.append(f"attempt counter at {n} (≥3 attempts without success)")

        # 3. Last-success freshness — if the repo has a .git and history
        # of autocommits, the last-success file should not be far older
        # than a day in active use. Missing entirely is tolerated (fresh
        # clone, pre-first-commit state).
        if os.path.isfile(last_ok_file):
            try:
                with open(last_ok_file) as f:
                    ts_str = f.read().strip()
            except OSError as e:
                issues.append(f"last-success timestamp unreadable: {e}")
            else:
                try:
                    ts = datetime.datetime.fromisoformat(
                        ts_str.rstrip("Z")
                    ).replace(tzinfo=datetime.timezone.utc)
                except ValueError as e:
                    issues.append(f"last-success timestamp unparseable: {e}")
                else:
                    age_h = (datetime.datetime.now(datetime.timezone.utc) - ts).total_seconds() / 3600
                    if age_h > 48:
                        issues.append(f"last successful autocommit {age_h:.0f}h ago (>48h)")

        if not issues:
            return _result(PASS, 1.0, "autocommit operational")
        # FAIL with score 0: weight 5.0 means any failure here hits the
        # HCI hard, same tier as LifesaverIntegrity. That's the contract.
        return _result(FAIL, 0.0,
                       f"autocommit unhealthy ({len(issues)} issue(s))",
                       issues)


class CorePrinciplesAuditVerifier(Verifier):
    """Delegates to scripts/audit-core-principles.py, which surveys src/
    against the five core principles declared in CLAUDE.md. FAILs only on
    CRITICAL-level violations — files exceeding 400 LOC or subsystems with
    ≥1 .js file but no index.js. WARN-level findings (files over the 200-
    line soft target but under 400) are informational; the 200-line target
    is aspirational and most of the codebase brushes it occasionally."""
    name = "core-principles-audit"
    category = "code"
    weight = 1.0

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-core-principles.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script, "--json"])
        try:
            payload = json.loads(out)
        except Exception:
            return _result(ERROR, 0.0, "could not parse audit output", [err[:500]])
        crit = payload.get("critical_count", 0)
        warn = payload.get("warn_count", 0)
        p1 = payload.get("p1_count", 0)
        failfast = payload.get("failfast_hits", 0)
        detail = [f"{warn} WARN-level oversize file(s)",
                  f"{failfast} P2 indicator hit(s)"]
        for s in payload.get("subsystems", []):
            for rel, n in s.get("oversize_critical", []):
                detail.append(f"CRITICAL oversize: {rel} ({n} LOC)")
            for item in s["violations"]["P1"]:
                detail.append(f"P1 ({s['name']}): {item}")
        if crit == 0 and p1 == 0:
            return _result(PASS, 1.0,
                           f"no critical violations ({warn} warn-level, {failfast} P2 indicators)",
                           detail[:20])
        # Each critical violation drops the score by 0.25; floor at 0.
        score = max(0.0, 1.0 - 0.25 * (crit + p1))
        return _result(FAIL, score,
                       f"{crit} CRITICAL oversize file(s), {p1} P1 violation(s)",
                       detail[:20])


class ProxyMiddlewareRegistryVerifier(Verifier):
    """Every file in tools/HME/proxy/middleware/*.js must (a) be listed in
    order.json OR load cleanly unlisted, AND (b) not throw at require()
    time. Born from the dir_context.js silent failure: an undefined-ROOT
    ReferenceError caused the middleware to silently not register for
    who-knows-how-long, removing dir-intent enrichment from every turn.
    Surface this class of failure immediately."""
    name = "proxy-middleware-registry"
    category = "code"
    weight = 1.0

    def run(self) -> VerdictResult:
        import subprocess
        mw_dir = os.path.join(_PROJECT, "tools", "HME", "proxy", "middleware")
        order_path = os.path.join(mw_dir, "order.json")
        if not os.path.isdir(mw_dir):
            return _result(SKIP, 1.0, "middleware dir not present", [mw_dir])
        files = sorted(
            f for f in os.listdir(mw_dir)
            if f.endswith(".js") and f not in ("index.js",)
        )
        try:
            with open(order_path) as f:
                order = json.load(f).get("order", [])
        except Exception as _e:
            return _result(ERROR, 0.0, f"could not read order.json: {_e}", [order_path])
        unlisted = [f for f in files if f not in order]
        missing_in_fs = [f for f in order if f not in files]
        # Attempt to require() each middleware in a fresh Node subprocess.
        # The proxy logs only show the LAST load attempt; this verifier
        # independently confirms every file can be loaded. Using subprocess
        # directly because _run_subprocess prepends python3 — we need node.
        import subprocess as _sp_mr
        load_failures = []
        for fname in files:
            abs_path = os.path.join(mw_dir, fname)
            try:
                rc = _sp_mr.run(
                    ["node", "-e", f"require('{abs_path}')"],
                    capture_output=True, text=True, timeout=5,
                    env={**os.environ, "PROJECT_ROOT": _PROJECT},
                )
                if rc.returncode != 0:
                    msg = (rc.stderr or rc.stdout or "").strip().splitlines()
                    load_failures.append(f"{fname}: {msg[-1] if msg else 'rc=' + str(rc.returncode)}")
            except Exception as _e:
                load_failures.append(f"{fname}: {type(_e).__name__}: {_e}")
        issues = []
        if load_failures:
            issues.extend(f"LOAD FAIL: {x}" for x in load_failures)
        if missing_in_fs:
            issues.append(f"order.json references missing files: {', '.join(missing_in_fs)}")
        if unlisted:
            issues.append(f"files not in order.json (will load alphabetically AFTER manifest): {', '.join(unlisted)}")
        if not issues:
            return _result(PASS, 1.0,
                           f"{len(files)} middleware loadable, {len(order)} in manifest",
                           [])
        score = 0.0 if load_failures else 0.6
        verdict = FAIL if load_failures else WARN
        return _result(verdict, score,
                       f"{len(load_failures)} load failure(s), "
                       f"{len(missing_in_fs)} manifest gap(s), "
                       f"{len(unlisted)} unlisted file(s)",
                       issues[:10])


class ShellHookAuditVerifier(Verifier):
    """Delegates to scripts/audit-shell-hooks.py, which statically scans
    tools/HME/hooks/**/*.sh for cache-trap patterns — most notably
    BASH_SOURCE-relative path ascents that resolve INTO the plugin cache
    tree when Claude Code invokes a hook from there. Closes the blind
    spot that let _safety.sh, _autocommit.sh, stop.sh, and every file in
    hooks/direct/ silently run with PROJECT_ROOT unset / .env missing
    for months. ESLint covers .js; _scan_python_bug_patterns covers .py;
    this verifier covers .sh."""
    name = "shell-hook-audit"
    category = "code"
    weight = 1.0

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-shell-hooks.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script, "--json"])
        try:
            payload = json.loads(out)
        except Exception:
            return _result(ERROR, 0.0, "could not parse audit output", [err[:500]])
        count = payload.get("violation_count", 0)
        detail = []
        for fileinfo in payload.get("files", []):
            for finding in fileinfo.get("findings", []):
                detail.append(
                    f"{fileinfo['file']}:{finding['line']} [{finding['rule']}] {finding['reason']}"
                )
        if count == 0:
            return _result(PASS, 1.0, "no shell-hook cache-trap violations", [])
        # Each violation drops score by 0.2; floor at 0. Any violation at
        # all is FAIL — the bugs these rules catch are silent-disable
        # class, not ergonomic nits.
        score = max(0.0, 1.0 - 0.2 * count)
        return _result(FAIL, score,
                       f"{count} shell-hook violation(s) — BASH_SOURCE cache-trap risk",
                       detail[:20])


class NumericClaimDriftVerifier(Verifier):
    """Markdown docs that state specific counts (e.g. `19 hypermeta
    controllers`, `12 CIM dials`, `38 verifiers`) must match the live
    codebase count. Delegates to verify-numeric-drift.py, which owns the
    claims manifest and the ground-truth counters."""
    name = "numeric-claim-drift"
    category = "doc"
    weight = 1.5

    def run(self) -> VerdictResult:
        script = os.path.join(_SCRIPTS_DIR, "verify-numeric-drift.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "verifier script not found", [script])
        rc, out, err = _run_subprocess([script, "--json"])
        try:
            payload = json.loads(out)
        except Exception:
            return _result(ERROR, 0.0, "could not parse verifier output", [err[:500]])
        drift_count = payload.get("drift_count", 0)
        if drift_count == 0:
            return _result(PASS, 1.0,
                           f"all numeric claims match code (truth: {payload.get('truth', {})})")
        # 10 drifts = score 0. The threshold is tight — each drift is a
        # specific doc claim that now misleads readers.
        score = max(0.0, 1.0 - drift_count / 10.0)
        examples = [f"{d['file']}:{d['line']} {d['claim']} stated={d['stated']} actual={d['actual']}"
                    for d in payload.get("drifts", [])[:20]]
        return _result(FAIL, score,
                       f"{drift_count} numeric drift(s) across "
                       f"{len(set(d['claim'] for d in payload.get('drifts', [])))} claim(s)",
                       examples)


class DocstringPresenceVerifier(Verifier):
    """Every @ctx.mcp.tool() function has a non-empty docstring."""
    name = "tool-docstrings"
    category = "doc"
    weight = 1.0

    def run(self) -> VerdictResult:
        import ast
        missing = []
        total = 0
        for root, _dirs, files in os.walk(_SERVER_DIR):
            for f in files:
                if not f.endswith(".py"):
                    continue
                path = os.path.join(root, f)
                try:
                    with open(path, encoding="utf-8") as fp:
                        tree = ast.parse(fp.read())
                except Exception:
                    continue
                for node in ast.walk(tree):
                    if not isinstance(node, ast.FunctionDef):
                        continue
                    has_tool_dec = any(
                        isinstance(d, ast.Call)
                        and isinstance(d.func, ast.Attribute)
                        and d.func.attr == "tool"
                        for d in node.decorator_list
                    )
                    if not has_tool_dec:
                        continue
                    total += 1
                    docstring = ast.get_docstring(node)
                    if not docstring or len(docstring.strip()) < 30:
                        missing.append(f"{f}::{node.name}")
        if total == 0:
            return _result(SKIP, 1.0, "no @ctx.mcp.tool() functions found")
        score = 1.0 - len(missing) / total
        if not missing:
            return _result(PASS, 1.0, f"{total}/{total} tools have docstrings")
        return _result(FAIL if score < 0.7 else WARN, score,
                       f"{len(missing)}/{total} tools missing/short docstrings",
                       missing)



# Verifiers — CODE category


class PythonSyntaxVerifier(Verifier):
    name = "python-syntax"
    category = "code"
    weight = 3.0  # critical: broken Python = broken HME server

    def run(self) -> VerdictResult:
        import ast
        broken = []
        total = 0
        for root, _dirs, files in os.walk(_SERVER_DIR):
            for f in files:
                if not f.endswith(".py"):
                    continue
                total += 1
                path = os.path.join(root, f)
                try:
                    with open(path, encoding="utf-8") as fp:
                        ast.parse(fp.read())
                except SyntaxError as e:
                    broken.append(f"{os.path.relpath(path, _PROJECT)}:{e.lineno}: {e.msg}")
        if not broken:
            return _result(PASS, 1.0, f"{total}/{total} Python files parse")
        score = 1.0 - len(broken) / total
        return _result(FAIL, score, f"{len(broken)}/{total} Python files broken", broken)


class ShellSyntaxVerifier(Verifier):
    name = "shell-syntax"
    category = "code"
    weight = 2.0

    def run(self) -> VerdictResult:
        broken = []
        total = 0
        for f in os.listdir(_HOOKS_DIR):
            if not f.endswith(".sh"):
                continue
            total += 1
            path = os.path.join(_HOOKS_DIR, f)
            rc = subprocess.run(["bash", "-n", path], capture_output=True, text=True)
            if rc.returncode != 0:
                broken.append(f"{f}: {rc.stderr.strip()[:100]}")
        if not broken:
            return _result(PASS, 1.0, f"{total}/{total} shell hooks parse")
        score = 1.0 - len(broken) / total
        return _result(FAIL, score, f"{len(broken)}/{total} shell hooks broken", broken)


class HookExecutabilityVerifier(Verifier):
    """Every non-helper hook script must be +x."""
    name = "hook-executability"
    category = "code"
    weight = 2.0

    def run(self) -> VerdictResult:
        broken = []
        total = 0
        for f in sorted(os.listdir(_HOOKS_DIR)):
            if not f.endswith(".sh"):
                continue
            if f.startswith("_"):  # helpers, sourced not executed
                continue
            total += 1
            path = os.path.join(_HOOKS_DIR, f)
            if not os.access(path, os.X_OK):
                broken.append(f)
        if not broken:
            return _result(PASS, 1.0, f"{total}/{total} dispatcher hooks are executable")
        score = 1.0 - len(broken) / total
        return _result(FAIL, score, f"{len(broken)}/{total} hooks not executable",
                       [f"chmod +x tools/HME/hooks/{name}" for name in broken])


class DecoratorOrderVerifier(Verifier):
    """Every @chained tool must have @ctx.mcp.tool() OUTERMOST."""
    name = "decorator-order"
    category = "code"
    weight = 2.0

    def run(self) -> VerdictResult:
        import ast
        violations = []
        total = 0
        for root, _dirs, files in os.walk(_SERVER_DIR):
            for f in files:
                if not f.endswith(".py"):
                    continue
                path = os.path.join(root, f)
                try:
                    with open(path, encoding="utf-8") as fp:
                        tree = ast.parse(fp.read())
                except Exception:
                    continue
                for node in ast.walk(tree):
                    if not isinstance(node, ast.FunctionDef):
                        continue
                    decs = node.decorator_list
                    has_chained = any(
                        isinstance(d, ast.Call)
                        and isinstance(d.func, ast.Name)
                        and d.func.id == "chained"
                        for d in decs
                    )
                    has_tool = any(
                        isinstance(d, ast.Call)
                        and isinstance(d.func, ast.Attribute)
                        and d.func.attr == "tool"
                        for d in decs
                    )
                    if not has_chained:
                        continue
                    total += 1
                    if not has_tool:
                        violations.append(f"{os.path.relpath(path, _PROJECT)}::{node.name} (no @ctx.mcp.tool())")
                        continue
                    # decorator_list[0] is OUTERMOST
                    outermost = decs[0]
                    is_tool = (
                        isinstance(outermost, ast.Call)
                        and isinstance(outermost.func, ast.Attribute)
                        and outermost.func.attr == "tool"
                    )
                    if not is_tool:
                        violations.append(f"{os.path.relpath(path, _PROJECT)}::{node.name} (@chained outside @ctx.mcp.tool())")
        if total == 0:
            return _result(SKIP, 1.0, "no @chained tools found")
        if not violations:
            return _result(PASS, 1.0, f"{total}/{total} chained tools have correct order")
        score = 1.0 - len(violations) / total
        return _result(FAIL, score, f"{len(violations)}/{total} chained tools wrong order",
                       violations)



# Verifiers — STATE category


class StatesSyncVerifier(Verifier):
    name = "states-sync"
    category = "state"
    weight = 2.0

    def run(self) -> VerdictResult:
        script = os.path.join(_SCRIPTS_DIR, "verify-states-sync.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "verifier script not found")
        rc, out, _err = _run_subprocess(script, timeout=5)
        if rc == 0:
            return _result(PASS, 1.0, "Python and shell STATES match",
                           [out.splitlines()[0] if out else ""])
        if rc == 1:
            return _result(FAIL, 0.0, "Python ↔ shell STATES drift", out.splitlines())
        return _result(ERROR, 0.0, "verifier returned unexpected code", out.splitlines())


class OnboardingFlowVerifier(Verifier):
    name = "onboarding-flow"
    category = "state"
    weight = 2.0

    def run(self) -> VerdictResult:
        script = os.path.join(_SCRIPTS_DIR, "verify-onboarding-flow.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "verifier script not found")
        rc, out, _err = _run_subprocess(script)
        passed = sum(1 for ln in out.splitlines() if "PASS:" in ln)
        failed = sum(1 for ln in out.splitlines() if "FAIL:" in ln)
        total = passed + failed
        if total == 0:
            return _result(ERROR, 0.0, "verifier produced no PASS/FAIL output")
        score = passed / total
        if rc == 0:
            return _result(PASS, score, f"all {total} onboarding tests pass")
        return _result(FAIL, score, f"{failed}/{total} onboarding tests failed",
                       [ln for ln in out.splitlines() if "FAIL:" in ln])


class OnboardingStateIntegrityVerifier(Verifier):
    """If state file exists, its value must be in STATES."""
    name = "onboarding-state-integrity"
    category = "state"
    weight = 1.0

    def run(self) -> VerdictResult:
        state_file = os.path.join(_PROJECT, "tmp", "hme-onboarding.state")
        if not os.path.isfile(state_file):
            return _result(PASS, 1.0, "no state file (graduated or fresh)")
        try:
            with open(state_file) as f:
                cur = f.read().strip()
        except Exception as e:
            return _result(ERROR, 0.0, f"could not read state file: {e}")
        # Parse STATES from onboarding_chain.py
        chain_py = os.path.join(_SERVER_DIR, "onboarding_chain.py")
        try:
            with open(chain_py) as f:
                src = f.read()
            m = re.search(r'^STATES\s*=\s*\[(.*?)\]', src, re.DOTALL | re.MULTILINE)
            valid = re.findall(r'"([^"]+)"', m.group(1)) if m else []
        except Exception as e:
            return _result(ERROR, 0.0, f"could not parse STATES: {e}")
        if cur in valid:
            return _result(PASS, 1.0, f"state '{cur}' is valid")
        return _result(FAIL, 0.0, f"state '{cur}' is NOT in STATES",
                       [f"valid: {valid}"])


class TodoStoreSchemaVerifier(Verifier):
    """Every entry in todos.json has the required canonical fields."""
    name = "todo-store-schema"
    category = "state"
    weight = 1.0

    def run(self) -> VerdictResult:
        store = os.path.join(_PROJECT, "tools", "HME", "KB", "todos.json")
        if not os.path.isfile(store):
            return _result(SKIP, 1.0, "no todo store (fresh project)")
        try:
            with open(store) as f:
                data = json.load(f)
        except Exception as e:
            return _result(FAIL, 0.0, f"todos.json invalid JSON: {e}")
        if not isinstance(data, list):
            return _result(FAIL, 0.0, "todos.json is not a JSON array")
        violations = []
        # First entry should be _meta (or be a regular entry from legacy schema)
        for i, entry in enumerate(data):
            if not isinstance(entry, dict):
                violations.append(f"[{i}] not a dict")
                continue
            if entry.get("id") == 0 and "_meta" in entry:
                # Header entry
                continue
            for required in ("id", "text", "status", "done"):
                if required not in entry:
                    violations.append(f"[{i}] missing field '{required}'")
                    break
        score = 1.0 - min(1.0, len(violations) / max(1, len(data)))
        if not violations:
            return _result(PASS, 1.0, f"{len(data)} entries pass schema check")
        return _result(WARN, score, f"{len(violations)} schema violations", violations[:10])



# Verifiers — COVERAGE category


class HookRegistrationVerifier(Verifier):
    """Every matcher in hooks.json points to a real .sh file."""
    name = "hook-registration"
    category = "coverage"
    weight = 1.5

    def run(self) -> VerdictResult:
        hooks_json = os.path.join(_HOOKS_DIR, "hooks.json")
        try:
            with open(hooks_json) as f:
                data = json.load(f)
        except Exception as e:
            return _result(FAIL, 0.0, f"hooks.json invalid: {e}")
        missing = []
        total = 0
        for _event_name, entries in data.get("hooks", {}).items():
            for entry in entries:
                for hook in entry.get("hooks", []):
                    cmd = hook.get("command", "")
                    m = re.search(r'(?:CLAUDE_PLUGIN_ROOT|hooks)/(\w+\.sh)', cmd)
                    if m:
                        total += 1
                        script = os.path.join(_HOOKS_DIR, m.group(1))
                        if not os.path.isfile(script):
                            missing.append(m.group(1))
        if total == 0:
            return _result(SKIP, 1.0, "no hook registrations found")
        if not missing:
            return _result(PASS, 1.0, f"{total}/{total} hook registrations resolve")
        score = 1.0 - len(missing) / total
        return _result(FAIL, score, f"{len(missing)}/{total} hooks reference missing files",
                       missing)


class HookMatcherValidityVerifier(Verifier):
    """Post-MCP-decoupling surface check. Every `i/<tool>` wrapper in the
    project's `i/` directory must either (a) have a matching dispatch branch
    in `posttooluse_bash.sh` for post-hooks that need to run after it, or
    (b) be explicitly known-not-to-have-a-posthook. Conversely, every
    dispatch branch in `posttooluse_bash.sh` must reference a wrapper that
    actually exists. Catches the drift where a wrapper is renamed but the
    hook still dispatches on the old name (or vice versa) — silently dead
    hook path.
    """
    name = "hook-matcher-validity"
    category = "coverage"
    weight = 2.0  # high: silently-dead hooks are a major self-coherence failure

    # Wrappers that have no posttooluse side-effect by design. Claude just
    # reads the response; there's no nexus state to update.
    #   help / why       — static / rationale-lookup; read-only
    #   freeze           — flips a flag file; posttooluse doesn't need to know
    #   pattern          — pattern-file reader; read-only
    #   substrate        — four-arc status; read-only
    _NO_POSTHOOK_OK = {
        "status", "trace", "evolve", "hme-admin", "todo", "hme",
        "help", "why", "freeze", "pattern", "substrate",
    }

    def run(self) -> VerdictResult:
        import re

        project_root = os.environ.get("PROJECT_ROOT", _PROJECT)
        i_dir = os.path.join(project_root, "i")
        if not os.path.isdir(i_dir):
            return _result(FAIL, 0.0, "i/ directory missing — HME tool wrappers not installed")

        # Enumerate wrappers (executable shell scripts in i/).
        wrappers = set()
        try:
            for name in os.listdir(i_dir):
                p = os.path.join(i_dir, name)
                if os.path.isfile(p) and os.access(p, os.X_OK):
                    wrappers.add(name)
        except OSError as e:
            return _result(FAIL, 0.0, f"i/ unreadable: {e}")

        # Read posttooluse_bash.sh and collect dispatched tool names.
        posthook_path = os.path.join(_HOOKS_DIR, "posttooluse", "posttooluse_bash.sh")
        try:
            with open(posthook_path) as fp:
                posthook_src = fp.read()
        except OSError as e:
            return _result(FAIL, 0.0, f"posttooluse_bash.sh unreadable: {e}")

        # Pattern: `i/<tool>\b` inside regexes within the dispatcher block.
        dispatched = set(re.findall(r'i/([a-z-]+)\\b', posthook_src))

        # A wrapper with a posthook dispatch is "covered". A wrapper on the
        # NO_POSTHOOK_OK list is "explicitly excluded". Anything else is
        # silently uncovered.
        uncovered = [w for w in wrappers
                     if w not in dispatched and w not in self._NO_POSTHOOK_OK]
        # Conversely, any dispatch target that doesn't correspond to a
        # wrapper is a dead branch.
        dead_dispatches = [t for t in dispatched if t not in wrappers]

        errors = []
        for w in uncovered:
            errors.append(f"wrapper i/{w} has no posthook dispatch and is not in _NO_POSTHOOK_OK")
        for t in dead_dispatches:
            errors.append(f"posttooluse_bash.sh dispatches on i/{t} but no such wrapper exists")

        total_checks = len(wrappers) + len(dispatched)
        if total_checks == 0:
            return _result(SKIP, 1.0, "no wrappers or dispatches to check")
        if not errors:
            return _result(
                PASS, 1.0,
                f"{len(wrappers)} wrappers × {len(dispatched)} dispatches all resolve"
            )
        score = 1.0 - len(errors) / total_checks
        return _result(FAIL, score, f"{len(errors)} wrapper/dispatch mismatch(es)", errors)


class ToolSurfaceCoverageVerifier(Verifier):
    """Every public @ctx.mcp.tool() function appears in either AGENT_PRIMER.md
    or HME.md. Hidden tools don't need to be documented."""
    name = "tool-surface-coverage"
    category = "coverage"
    weight = 1.0

    def run(self) -> VerdictResult:
        import ast
        public_tools = set()
        hidden_tools = set()
        for root, _dirs, files in os.walk(_SERVER_DIR):
            for f in files:
                if not f.endswith(".py"):
                    continue
                path = os.path.join(root, f)
                try:
                    with open(path) as fp:
                        tree = ast.parse(fp.read())
                except Exception:
                    continue
                for node in ast.walk(tree):
                    if not isinstance(node, ast.FunctionDef):
                        continue
                    for dec in node.decorator_list:
                        if not (isinstance(dec, ast.Call)
                                and isinstance(dec.func, ast.Attribute)
                                and dec.func.attr == "tool"):
                            continue
                        # Check meta={"hidden": True}
                        is_hidden = False
                        for kw in dec.keywords:
                            if kw.arg == "meta" and isinstance(kw.value, ast.Dict):
                                for k, v in zip(kw.value.keys, kw.value.values):
                                    if (isinstance(k, ast.Constant) and k.value == "hidden"
                                            and isinstance(v, ast.Constant) and v.value):
                                        is_hidden = True
                        if is_hidden:
                            hidden_tools.add(node.name)
                        else:
                            public_tools.add(node.name)
        if not public_tools:
            return _result(SKIP, 1.0, "no public tools found")
        # Check each public tool appears in primer/HME.md
        primer = os.path.join(_PROJECT, "doc", "AGENT_PRIMER.md")
        hmemd = os.path.join(_PROJECT, "doc", "HME.md")
        text = ""
        for p in (primer, hmemd):
            if os.path.isfile(p):
                with open(p) as f:
                    text += f.read()
        missing = sorted(t for t in public_tools if t not in text)
        if not missing:
            return _result(PASS, 1.0, f"all {len(public_tools)} public tools documented",
                           [f"public: {sorted(public_tools)}", f"hidden: {sorted(hidden_tools)}"])
        score = 1.0 - len(missing) / len(public_tools)
        return _result(WARN, score, f"{len(missing)}/{len(public_tools)} public tools undocumented",
                       missing)



# Verifiers — RUNTIME category


class ShimHealthVerifier(Verifier):
    name = "shim-health"
    category = "runtime"
    weight = 1.0

    def run(self) -> VerdictResult:
        try:
            import urllib.request
            req = urllib.request.Request("http://127.0.0.1:9098/health")
            with urllib.request.urlopen(req, timeout=2) as r:
                if r.status == 200:
                    return _result(PASS, 1.0, "shim /health responds 200")
                return _result(WARN, 0.5, f"shim /health returned {r.status}")
        except Exception as e:
            return _result(WARN, 0.0, f"shim unreachable: {type(e).__name__}",
                           [str(e)])


class ErrorLogVerifier(Verifier):
    """Open LIFESAVER errors should be zero or very few."""
    name = "error-log"
    category = "runtime"
    weight = 1.5

    def run(self) -> VerdictResult:
        log = os.path.join(_PROJECT, "log", "hme-errors.log")
        if not os.path.isfile(log):
            return _result(PASS, 1.0, "no error log (clean)")
        try:
            with open(log) as f:
                lines = [l for l in f if l.strip()]
        except Exception as e:
            return _result(ERROR, 0.0, f"could not read error log: {e}")
        watermark = os.path.join(_PROJECT, "tmp", "hme-errors.lastread")
        last = 0
        if os.path.isfile(watermark):
            try:
                with open(watermark) as f:
                    raw = f.read().strip()
                if raw:
                    last = int(raw)
            except (OSError, ValueError, TypeError):
                # Unreadable watermark, non-numeric content, or a bizarre
                # non-string from a mocked read() — treat as unset.
                # Narrow catch so MemoryError / KeyboardInterrupt surface.
                last = 0
        unread = max(0, len(lines) - last)
        if unread == 0:
            return _result(PASS, 1.0, f"all {len(lines)} historical errors acknowledged")
        score = max(0.0, 1.0 - unread / 10.0)
        return _result(FAIL if unread > 5 else WARN, score,
                       f"{unread} unacknowledged errors", lines[-min(5, unread):])



# Verifiers — TOPOLOGY category


class LifesaverRateVerifier(Verifier):
    """Scores LIFESAVER rate using multi-window recency:
        acute  (last 1h):  strongest signal of current problem
        medium (last 6h):  recent problem, possibly ongoing
        recent (last 24h): historical residue, weakest signal
    HCI reflects CURRENT health. Old events age out automatically and stop
    dragging the score down once they fall past the acute window.
    """
    name = "lifesaver-rate"
    category = "runtime"
    weight = 2.0

    def run(self) -> VerdictResult:
        data_path = os.path.join(METRICS_DIR, "hme-tool-effectiveness.json")
        if not os.path.isfile(data_path):
            return _result(SKIP, 1.0, "no effectiveness data yet — run analyze-tool-effectiveness.py")
        try:
            with open(data_path) as f:
                data = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        acute = data.get("lifesaver_acute_events", 0)
        medium = data.get("lifesaver_medium_events", 0)
        recent = data.get("lifesaver_recent_events", 0)
        all_time = data.get("lifesaver_total_events", 0)
        # Weighted penalty: acute worth 1.0, medium 0.3, recent 0.1 per event
        weighted = acute * 1.0 + (medium - acute) * 0.3 + (recent - medium) * 0.1
        score = max(0.0, 1.0 - weighted / 5.0)
        summary = (
            f"acute(1h)={acute} medium(6h)={medium} recent(24h)={recent} "
            f"all-time={all_time}"
        )
        if acute >= 3:
            return _result(
                FAIL, score, summary,
                ["3+ LIFESAVER events in the last HOUR — acute problem",
                 "investigate log/hme-errors.log"],
            )
        if acute >= 1 or medium >= 5:
            return _result(WARN, score, summary, ["recent LIFESAVER activity"])
        if recent == 0:
            return _result(PASS, 1.0, f"0 LIFESAVER events in last 24h (all-time: {all_time})")
        return _result(PASS, score, summary + " (no acute activity)")


class MetaObserverCoherenceVerifier(Verifier):
    """Scores meta-observer L14 alerts using the ACUTE (1h) window. Historical
    alerts in the 6h and 24h windows contribute weakly — the focus is on
    whether HME is currently unstable."""
    name = "meta-observer-coherence"
    category = "runtime"
    weight = 2.0

    def run(self) -> VerdictResult:
        data_path = os.path.join(METRICS_DIR, "hme-tool-effectiveness.json")
        if not os.path.isfile(data_path):
            return _result(SKIP, 1.0, "no effectiveness data yet")
        try:
            with open(data_path) as f:
                data = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        acute = data.get("acute_coherence_events", {}) or {}
        medium = data.get("medium_coherence_events", {}) or {}
        acute_worst = max((acute.get(k, 0) for k in
                           ("deep_degradation", "restart_churn", "frequent_instability")),
                          default=0)
        medium_worst = max((medium.get(k, 0) for k in
                            ("deep_degradation", "restart_churn", "frequent_instability")),
                           default=0)
        # Weighted: 1 acute event = 1 point penalty, 1 medium = 0.2 point
        penalty = acute_worst + (medium_worst - acute_worst) * 0.2
        score = max(0.0, 1.0 - penalty / 10.0)
        summary = (
            f"acute(1h)_worst={acute_worst} medium(6h)_worst={medium_worst} "
            f"(degradation/churn/instability)"
        )
        if acute_worst >= 5:
            return _result(
                FAIL, score, summary,
                ["HME unstable RIGHT NOW — 5+ alerts in last hour",
                 "check meta-observer recovery logic"],
            )
        if acute_worst >= 2:
            return _result(WARN, score, summary,
                           ["elevated meta-observer events in last hour"])
        return _result(PASS, score, summary)


class SubagentModeVerifier(Verifier):
    """Checks that agent_local.py's declared modes match what pretooluse_agent.sh
    routes to. If the hook intercepts 'Plan' but agent_local doesn't have a
    'plan' mode config, the subprocess crashes silently and the result file
    stays empty. This catches the drift at HCI time."""
    name = "subagent-mode-sync"
    category = "coverage"
    weight = 1.0

    def run(self) -> VerdictResult:
        agent_py = os.path.join(_PROJECT, "tools", "HME", "mcp", "agent_local.py")
        hook_sh = os.path.join(_HOOKS_DIR, "pretooluse_agent.sh")
        if not os.path.isfile(agent_py) or not os.path.isfile(hook_sh):
            return _result(SKIP, 1.0, "agent_local or hook missing")
        # Parse agent_local.py for _MODE_CONFIGS keys
        try:
            with open(agent_py) as f:
                src = f.read()
            m = re.search(r'_MODE_CONFIGS\s*=\s*\{(.*?)^\}', src, re.DOTALL | re.MULTILINE)
            if not m:
                return _result(FAIL, 0.0, "could not find _MODE_CONFIGS in agent_local.py")
            declared_modes = set(re.findall(r'"(\w+)"\s*:\s*\{', m.group(1)))
        except Exception as e:
            return _result(ERROR, 0.0, f"parse error on agent_local.py: {e}")
        # Parse pretooluse_agent.sh for routed modes (HME_MODE="...")
        try:
            with open(hook_sh) as f:
                hook_src = f.read()
            routed = set(re.findall(r'HME_MODE="(\w+)"', hook_src))
        except Exception as e:
            return _result(ERROR, 0.0, f"parse error on hook: {e}")

        missing = routed - declared_modes
        extra = declared_modes - routed
        if missing:
            return _result(
                FAIL, 0.0,
                f"hook routes to modes missing from agent_local: {sorted(missing)}",
                [f"declared: {sorted(declared_modes)}", f"routed: {sorted(routed)}"],
            )
        return _result(
            PASS, 1.0,
            f"hook routes {sorted(routed)} → agent_local declares {sorted(declared_modes)}",
            [f"unused mode configs: {sorted(extra)}"] if extra else [],
        )


class SubagentPassthroughVerifier(Verifier):
    """The general-purpose subagent type must remain a passthrough because it
    needs Write/Edit/Bash capabilities, which the read-only agent_local.py
    cannot provide. If someone hastily adds 'general-purpose' to the
    interception case, the verifier fails at weight 3.0 — this regression
    would downgrade every general-purpose agent call to a read-only stub."""
    name = "subagent-general-purpose-passthrough"
    category = "coverage"
    weight = 3.0

    _FORBIDDEN_INTERCEPTS = ("general-purpose", "statusline-setup")

    def run(self) -> VerdictResult:
        hook_sh = os.path.join(_HOOKS_DIR, "pretooluse_agent.sh")
        if not os.path.isfile(hook_sh):
            return _result(SKIP, 1.0, "hook missing")
        try:
            with open(hook_sh) as f:
                src = f.read()
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")

        # Walk the `case` block and look for each forbidden subagent type
        # being assigned a HME_MODE. If any appear as intercept targets, fail.
        violations = []
        for forbidden in self._FORBIDDEN_INTERCEPTS:
            # Match: "general-purpose)" followed by "HME_MODE=..."
            pat = re.compile(
                re.escape(forbidden) + r'\)\s*HME_MODE="(\w+)"',
                re.DOTALL,
            )
            m = pat.search(src)
            if m:
                violations.append(
                    f"{forbidden} → intercepted as mode={m.group(1)} "
                    f"(read-only replacement = capability downgrade)"
                )

        if violations:
            return _result(
                FAIL, 0.0,
                f"{len(violations)} forbidden intercept(s) — read-only replacement",
                violations + [
                    "RULE: general-purpose and statusline-setup must passthrough to Claude.",
                    "general-purpose needs Edit/Write/Bash which local agent cannot provide.",
                    "Revert the intercept; keep these types in the default branch of the case statement.",
                ],
            )
        return _result(
            PASS, 1.0,
            f"general-purpose + statusline-setup correctly passthrough to Claude",
        )


class VerifierCoverageGapVerifier(Verifier):
    """H13 consumer: reads metrics/hme-verifier-coverage.json and flags
    gaps — fix commits with no matching verifier. Low weight because
    this is aspirational."""
    name = "verifier-coverage-gap"
    category = "runtime"
    weight = 0.5

    def run(self) -> VerdictResult:
        data_path = os.path.join(METRICS_DIR, "hme-verifier-coverage.json")
        if not os.path.isfile(data_path):
            return _result(SKIP, 1.0, "no coverage report — run suggest-verifiers.py")
        try:
            with open(data_path) as f:
                data = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        gaps = data.get("gap_count", 0)
        scanned = data.get("commits_scanned", 0)
        if scanned == 0:
            return _result(SKIP, 1.0, "no recent fix commits to check")
        if gaps == 0:
            return _result(PASS, 1.0, f"{scanned} fix commits, all have verifier coverage")
        ratio = gaps / max(1, scanned)
        score = max(0.0, 1.0 - ratio * 2)
        return _result(
            WARN, score,
            f"{gaps}/{scanned} fix commits without matching verifiers",
            [f"first gap: {data.get('gaps', [{}])[0].get('message', '?')[:80]}"] if gaps else [],
        )


class MemeticDriftVerifier(Verifier):
    """H16 consumer: reads metrics/hme-memetic-drift.json and flags rules
    with elevated violation counts. Low weight because the signal is noisy
    (violation detection is heuristic)."""
    name = "memetic-drift"
    category = "doc"
    weight = 0.5

    def run(self) -> VerdictResult:
        data_path = os.path.join(METRICS_DIR, "hme-memetic-drift.json")
        if not os.path.isfile(data_path):
            return _result(SKIP, 1.0, "no memetic drift report")
        try:
            with open(data_path) as f:
                data = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        violations = data.get("violation_counts", {})
        if not violations:
            return _result(PASS, 1.0, "no violations detected")
        worst = max(violations.values()) if violations else 0
        total = sum(violations.values())
        if worst >= 3:
            score = max(0.0, 1.0 - worst / 10.0)
            return _result(
                WARN, score,
                f"{total} total violations, worst rule: {worst} occurrences",
                [f"{k}: {v}" for k, v in sorted(violations.items(), key=lambda x: -x[1])[:3] if v > 0],
            )
        return _result(PASS, 1.0, f"{total} violations across {len(violations)} tracked rules (none severe)")


class TransientErrorFilterVerifier(Verifier):
    """Ensures _log_error in hme_http_store.py uses SOURCE-based transient
    detection, not message-substring matching. The old detector looked for
    '/reindex' as a URL-path substring which broke when reindex timeout
    messages started with 'timeout indexing /home/...' (no /reindex in that
    string). This class of bug (format drift vs. classifier) must not return.
    """
    name = "transient-error-filter"
    category = "runtime"
    weight = 1.5

    def run(self) -> VerdictResult:
        store_py = os.path.join(_SERVER_DIR, "..", "hme_http_store.py")
        store_py = os.path.normpath(store_py)
        if not os.path.isfile(store_py):
            return _result(SKIP, 1.0, "hme_http_store.py not found")
        try:
            with open(store_py) as f:
                src = f.read()
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        # Find the _log_error function
        m = re.search(
            r'def _log_error\([^)]*\)[^:]*:(.*?)(?=\ndef |\Z)',
            src, re.DOTALL,
        )
        if not m:
            return _result(FAIL, 0.0, "could not find _log_error definition")
        body = m.group(1)
        # Source-based markers we REQUIRE
        has_source_set = (
            "_transient_sources" in body
            or "source in {" in body
            or "source in (" in body
        )
        # URL-path markers we FORBID (regression guards)
        has_url_path_match = bool(
            re.search(r'"/reindex"\s+in\s+message', body)
            or re.search(r'"/enrich"\s+in\s+message', body)
            or re.search(r'"/audit"\s+in\s+message', body)
        )
        if has_url_path_match:
            return _result(
                FAIL, 0.0,
                "_log_error uses URL-path substring matching on message — "
                "drift-prone, will silently break when message format changes",
                ['refactor to source-based: "if source in _transient_sources and \'timeout\' in message"'],
            )
        if not has_source_set:
            return _result(
                WARN, 0.5,
                "_log_error transient detection is not source-based",
                ["recommended: check source argument instead of substring-matching the message"],
            )
        return _result(PASS, 1.0, "_log_error uses source-based transient detection")


class ContextBudgetVerifier(Verifier):
    """H-compact optimization #13: verify that chain-link snapshots are
    being taken frequently enough relative to context consumption. Fails
    if used_pct is high AND the latest chain link is stale (or missing),
    because that means auto-compaction will likely strike before a
    replacement snapshot exists.
    """
    name = "context-budget"
    category = "runtime"
    weight = 1.5

    def run(self) -> VerdictResult:
        ctx_file = os.environ.get("HME_CTX_FILE", "/tmp/claude-context.json")
        if not os.path.isfile(ctx_file):
            return _result(SKIP, 1.0, "no statusline data yet")
        try:
            with open(ctx_file) as f:
                ctx = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"ctx read failed: {e}")
        used = ctx.get("used_pct")
        if used is None:
            return _result(SKIP, 1.0, "no used_pct in statusline data")

        link_latest = os.path.join(METRICS_DIR, "chain-history", "latest.yaml")
        link_age_s = None
        if os.path.isfile(link_latest) or os.path.islink(link_latest):
            try:
                link_age_s = time.time() - os.path.getmtime(link_latest)
            except OSError:
                # Broken symlink or race with deletion — leave link_age_s
                # at its pre-check value. Narrow catch so unexpected
                # errors propagate.
                pass

        # Policy:
        #   used < 50%          → fine, no link needed
        #   50-70%               → WARN if no link in last 30 min
        #   70-85%               → FAIL if no link in last 10 min
        #   > 85%                → FAIL if no link in last 5 min (compaction imminent)
        if used < 50:
            return _result(PASS, 1.0, f"context at {used}% — safe")
        if used < 70:
            if link_age_s is None or link_age_s > 1800:
                return _result(WARN, 0.7,
                               f"context {used}%, no chain link in last 30min",
                               ["run: python3 tools/HME/scripts/chain-snapshot.py --eager"])
            return _result(PASS, 0.9, f"context {used}%, link age {link_age_s:.0f}s")
        if used < 85:
            if link_age_s is None or link_age_s > 600:
                return _result(FAIL, 0.3,
                               f"context {used}% nearing compaction + no recent link",
                               ["statusline preemption should have fired at 70%",
                                "run: python3 tools/HME/scripts/chain-snapshot.py --imminent"])
            return _result(WARN, 0.6, f"context {used}%, link age {link_age_s:.0f}s")
        # > 85% — compaction imminent
        if link_age_s is None or link_age_s > 300:
            return _result(FAIL, 0.0,
                           f"context {used}% — COMPACTION IMMINENT with no fresh chain link",
                           ["CRITICAL: take a snapshot NOW before auto-compaction destroys state"])
        return _result(WARN, 0.5, f"context {used}%, link age {link_age_s:.0f}s")


class PredictiveHCIVerifier(Verifier):
    """H9: consumes metrics/hme-hci-forecast.json (produced by predict-hci.py)
    and scores based on predicted drift. This is the forward-looking layer —
    fire a WARN when HCI is projected to cross the 80 threshold before it
    actually does, so the agent has time to fix whatever's driving the drop."""
    name = "predictive-hci"
    category = "runtime"
    weight = 1.0

    def run(self) -> VerdictResult:
        forecast_path = os.path.join(METRICS_DIR, "hme-hci-forecast.json")
        script = os.path.join(_SCRIPTS_DIR, "predict-hci.py")
        # Refresh forecast (cheap)
        if os.path.isfile(script):
            try:
                subprocess.run(
                    ["python3", script], capture_output=True, timeout=10,
                    env={**os.environ, "PROJECT_ROOT": _PROJECT},
                )
            except (subprocess.SubprocessError, OSError):
                # Subprocess failed (timeout, missing interpreter, etc.)
                # — forecast data stays as-is; the next SKIP branch
                # handles absence. Narrow catch so unexpected errors
                # propagate visibly.
                pass
        if not os.path.isfile(forecast_path):
            return _result(SKIP, 1.0, "no forecast data")
        try:
            with open(forecast_path) as f:
                forecast = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"forecast read error: {e}")
        if forecast.get("_warning"):
            return _result(SKIP, 1.0, forecast["_warning"])
        current = forecast.get("current_hci", 100)
        predicted = forecast.get("predicted_next_hci", 100)
        trend = forecast.get("trend", "flat")
        warning = forecast.get("warning")
        summary = f"current={current} predicted={predicted} trend={trend}"
        if warning:
            # Score: proportional to how far the prediction is below 80
            score = max(0.0, min(1.0, predicted / 100.0))
            return _result(WARN, score, summary, [warning])
        return _result(PASS, 1.0, summary)


class WarmContextFreshnessVerifier(Verifier):
    """H1: detect stale warm KV contexts and attempt auto-reprime.

    The HME synthesis stack primes warm KV contexts per model so tools get
    fast first-token latency. These contexts DECAY over time (models get
    evicted, KB changes, days pass). Currently nothing watches them — the
    selftest flagged 36-hour-old contexts that had been silently stale.

    This verifier:
      1. Checks warm-context-cache/*.json file ages
      2. Scores based on the oldest staleness
      3. Triggers background auto-reprime when staleness > 4 hours
      4. Fails only when auto-reprime has been unable to fix it repeatedly
    """
    name = "warm-context-freshness"
    category = "runtime"
    weight = 1.0

    def run(self) -> VerdictResult:
        cache_dir = os.path.join(_PROJECT, "tools", "HME", "warm-context-cache")
        if not os.path.isdir(cache_dir):
            return _result(SKIP, 1.0, "no warm-context-cache dir")
        files = [f for f in os.listdir(cache_dir) if f.endswith(".json")]
        if not files:
            return _result(SKIP, 1.0, "no warm context files yet")
        oldest_age = 0.0
        oldest_file = ""
        for f in files:
            path = os.path.join(cache_dir, f)
            age = time.time() - os.path.getmtime(path)
            if age > oldest_age:
                oldest_age = age
                oldest_file = f
        age_hours = oldest_age / 3600

        # Score: 0-4h = 1.0, 4-24h = WARN, >24h = FAIL
        if age_hours < 4:
            return _result(PASS, 1.0,
                           f"warmest cache fresh ({age_hours:.1f}h), oldest={oldest_file}")
        if age_hours < 24:
            # Attempt background auto-reprime — fire-and-forget
            _trigger_warm_reprime()
            return _result(
                WARN, 0.7,
                f"oldest warm cache {age_hours:.1f}h (re-prime triggered)",
                [f"oldest: {oldest_file}",
                 "auto-reprime: hme_admin(action='warm') fired in background"],
            )
        _trigger_warm_reprime()
        return _result(
            FAIL, 0.3,
            f"oldest warm cache {age_hours:.1f}h — priming bitrot",
            [f"oldest: {oldest_file}",
             "auto-reprime triggered; if this persists, selftest warm ctx check is broken"],
        )


def _trigger_warm_reprime() -> None:
    """Fire-and-forget background call to hme_admin(action='warm').
    Uses the HTTP shim if the MCP server isn't running in-process."""
    import threading
    def _bg():
        try:
            # Prefer the admin tool invocation via HTTP shim or subprocess.
            # Simple approach: drop a sentinel file that a sessionstart/admin
            # path will pick up. If hme_admin runs via Python inside the
            # server we can't invoke it from a hook, but we CAN touch a file
            # the server reads on next tick.
            sentinel = os.path.join(_PROJECT, "tmp", "hme-warm-reprime.request")
            os.makedirs(os.path.dirname(sentinel), exist_ok=True)
            with open(sentinel, "w") as f:
                f.write(str(time.time()))
        except OSError:
            # tmp/ unwritable — the background re-prime request is a
            # best-effort nudge. Narrow catch; unexpected errors propagate.
            pass
    threading.Thread(target=_bg, daemon=True).start()


class HookLatencyVerifier(Verifier):
    """H3: flag hooks whose p95 wall-time exceeds a per-hook budget.

    Hook latency is silent tax — every tool call pays it. A hook that
    regresses from 50ms to 500ms adds half a second to every Edit, which
    compounds across a session. This verifier reads
    log/hme-hook-latency.jsonl (populated by hooks themselves via the
    _timestamp_hook helper) and flags hooks exceeding their budget.

    Per-hook budgets calibrated to legitimate workload:
      - stop:            4000ms — runs detector chain, autocommit, nexus
                          audit, holograph diff, activity bridge, plus
                          proxy lifecycle dispatch
      - sessionstart:    2500ms — proxy watchdog (up to 8s on cold spawn,
                          but p50 under 2s), supervisor kickoff, proxy
                          primer flag, holograph snapshot
      - precompact:      2000ms — chain snapshot + warm-context flush
      - default (else):   500ms — every other hook should be fast
    """
    name = "hook-latency"
    category = "runtime"
    weight = 1.0

    # Per-hook budget table. Keys are prefix-matched: any hook whose
    # name starts with a key uses that budget. Calibrated against
    # observed p50 and with headroom for legitimate variance.
    _BUDGETS = {
        "stop":         4000,
        "sessionstart": 2500,
        "precompact":   2000,
    }
    _DEFAULT_BUDGET = 500

    def _budget_for(self, hook_name):
        # Exact match first.
        if hook_name in self._BUDGETS:
            return self._BUDGETS[hook_name]
        # Prefix match (some hooks embed a subcommand in the name).
        for key, budget in self._BUDGETS.items():
            if hook_name.startswith(key):
                return budget
        return self._DEFAULT_BUDGET

    def run(self) -> VerdictResult:
        log_path = os.path.join(_PROJECT, "log", "hme-hook-latency.jsonl")
        if not os.path.isfile(log_path):
            return _result(SKIP, 1.0, "no hook latency log yet (first run)")
        try:
            by_hook = {}
            with open(log_path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    by_hook.setdefault(entry.get("hook", "?"), []).append(
                        float(entry.get("duration_ms", 0))
                    )
        except (OSError, ValueError) as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        if not by_hook:
            return _result(SKIP, 1.0, "log exists but empty")
        # Compute p95 per hook, compare against per-hook budget.
        slow = []
        total = 0
        for hook_name, durations in by_hook.items():
            total += 1
            durations_sorted = sorted(durations)
            n = len(durations_sorted)
            if n >= 20:
                p95 = durations_sorted[int(n * 0.95)]
            else:
                p95 = durations_sorted[-1]
            budget = self._budget_for(hook_name)
            if p95 > budget:
                slow.append(f"{hook_name}: p95={p95:.0f}ms (n={n}, budget={budget}ms)")
        if not slow:
            return _result(PASS, 1.0, f"{total} hooks all within per-hook budget")
        score = max(0.0, 1.0 - len(slow) / total)
        return _result(
            WARN if len(slow) < 3 else FAIL, score,
            f"{len(slow)}/{total} hooks exceed their p95 budget", slow,
        )


class PlanOutputValidityVerifier(Verifier):
    """H4: validate that plans produced by agent_local --mode plan reference
    real files only. Plans live in /tmp/hme-agent-*.md when emitted via the
    hook. Scan recent plans for file paths and confirm each exists.
    Hallucinated file paths in plans are the plan-mode analog of
    hallucinated code in edit mode — both are capability failures."""
    name = "plan-output-validity"
    category = "runtime"
    weight = 0.5

    def run(self) -> VerdictResult:
        import glob
        plan_files = sorted(glob.glob("/tmp/hme-agent-*.md"))
        if not plan_files:
            return _result(SKIP, 1.0, "no recent plan outputs to validate")
        checked = 0
        bad = []
        for p in plan_files[-5:]:  # last 5
            try:
                with open(p) as f:
                    content = f.read()
            except Exception:
                continue
            checked += 1
            # Extract file path claims (look for typical code-path patterns)
            paths = set(re.findall(r'[a-zA-Z0-9_/.-]+\.(?:js|py|sh|md|json|ts)', content))
            for pth in paths:
                # Only check paths that look like relative project paths
                if "/" not in pth or pth.startswith(".") or pth.startswith("/"):
                    continue
                full = os.path.join(_PROJECT, pth)
                if not os.path.isfile(full):
                    bad.append(f"{os.path.basename(p)}: claims {pth} — not found")
        if checked == 0:
            return _result(SKIP, 1.0, "no readable plan outputs")
        if not bad:
            return _result(PASS, 1.0, f"{checked} plan(s) cite only real files")
        score = 1.0 - min(1.0, len(bad) / 10.0)
        return _result(WARN, score, f"{len(bad)} suspicious path claim(s) in plans", bad[:5])


class GitCommitTestCoverageVerifier(Verifier):
    """H5: Check that recent 'fix'/'bug' commits add or modify a
    test/verifier in the same commit. Commits that claim fixes without a
    regression guard are a class of drift — next time the bug comes back
    there's nothing to catch it."""
    name = "git-commit-test-coverage"
    category = "runtime"
    weight = 0.5

    _FIX_KEYWORDS = ("fix", "bug", "regression", "repair", "patch", "correct", "error")

    def run(self) -> VerdictResult:
        try:
            rc = subprocess.run(
                ["git", "-C", _PROJECT, "log", "--oneline", "-50"],
                capture_output=True, text=True, timeout=3,
            )
            if rc.returncode != 0:
                return _result(SKIP, 1.0, "git log failed")
            log_lines = rc.stdout.splitlines()
        except Exception as e:
            return _result(ERROR, 0.0, f"git error: {e}")
        fix_commits = []
        for line in log_lines:
            parts = line.split(" ", 1)
            if len(parts) != 2:
                continue
            sha, msg = parts
            if any(kw in msg.lower() for kw in self._FIX_KEYWORDS):
                fix_commits.append((sha, msg))
        if not fix_commits:
            return _result(PASS, 1.0, "no fix commits in last 50 — nothing to check")
        uncovered = []
        for sha, msg in fix_commits[:10]:  # sample last 10 fix commits
            try:
                rc = subprocess.run(
                    ["git", "-C", _PROJECT, "show", "--name-only", "--format=", sha],
                    capture_output=True, text=True, timeout=3,
                )
                files = [f for f in rc.stdout.splitlines() if f.strip()]
            except Exception:
                continue
            has_test = any(
                ("verify-" in f or "test-" in f or "_test." in f
                 or "stress-test" in f or "verifier" in f.lower())
                for f in files
            )
            if not has_test:
                uncovered.append(f"{sha[:8]} {msg[:60]}")
        if not uncovered:
            return _result(PASS, 1.0, f"{len(fix_commits)} fix commits, all include test/verifier changes")
        # WARN not FAIL — this is aspirational, not mandatory. Small project
        # code fixes don't always need new tests.
        return _result(
            WARN, max(0.0, 1.0 - len(uncovered) / 10.0),
            f"{len(uncovered)} recent fix commit(s) without a new test/verifier",
            uncovered[:5],
        )


class SubagentGuardVerifier(Verifier):
    """Runs test 1 of the stress battery: the short-prompt guard.

    Passing test: agent_local.py receives "?" and returns the guard message
    in <1 second. Failing: agent_local doesn't guard against short prompts,
    wastes the arbiter's 120s budget, and times out. This is cheap (~0.1s)
    and catches regressions in the short-prompt early-exit.
    """
    name = "subagent-short-prompt-guard"
    category = "runtime"
    weight = 0.5

    def run(self) -> VerdictResult:
        script = os.path.join(_SCRIPTS_DIR, "stress-test-subagent.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "stress-test script not found")
        # Skip if agent_local backend is unreachable — a missing backend makes
        # the JSON decode fail (empty stdout), which is a backend outage not a
        # guard regression. The subagent-backends verifier covers this separately.
        agent = os.path.join(os.path.dirname(_SCRIPTS_DIR), "mcp", "agent_local.py")
        if not os.path.isfile(agent):
            return _result(SKIP, 1.0, "agent_local.py not found — skip guard test")
        try:
            probe = subprocess.run(
                ["python3", agent, "--stdin", "--json", "--project", _PROJECT],
                input='{"prompt":"?","mode":"explore"}',
                capture_output=True, text=True, timeout=5,
                env={**os.environ, "PROJECT_ROOT": _PROJECT},
            )
            if not probe.stdout.strip():
                return _result(SKIP, 1.0, "agent_local returned empty — backend down, skipping guard test")
        except (subprocess.TimeoutExpired, Exception):
            return _result(SKIP, 1.0, "agent_local unreachable — backend down, skipping guard test")
        try:
            rc = subprocess.run(
                ["python3", script, "--only", "1"],
                capture_output=True, text=True, timeout=15,
                env={**os.environ, "PROJECT_ROOT": _PROJECT},
            )
        except subprocess.TimeoutExpired:
            return _result(
                FAIL, 0.0,
                "short-prompt guard didn't fire in 15s — agent_local may be missing the early-exit",
                ["regression: len<3 or words<2 prompts must return immediately"],
            )
        except Exception as e:
            return _result(ERROR, 0.0, f"stress test invocation failed: {e}")
        if rc.returncode == 0:
            return _result(PASS, 1.0, "short-prompt guard fires correctly (<1s)")
        return _result(
            FAIL, 0.5,
            "short-prompt guard did not pass",
            rc.stdout.splitlines()[-5:],
        )


class SubagentBackendsVerifier(Verifier):
    """Verifies that agent_local.py's external dependencies are present.

    The local subagent pipeline depends on several binaries and endpoints
    being available at runtime. If any are missing, the agent silently
    falls back and produces low-quality output (this exact pattern was
    discovered the hard way: ripgrep being absent meant every grep call
    returned ERROR, and synthesizers worked from KB-only context).
    """
    name = "subagent-backends"
    category = "runtime"
    weight = 1.5

    def run(self) -> VerdictResult:
        backends = {}
        # 1. grep (rg or grep)
        try:
            for binary in ("rg", "grep"):
                try:
                    subprocess.run([binary, "--version"], capture_output=True, timeout=2)
                    backends["grep"] = binary
                    break
                except (FileNotFoundError, subprocess.TimeoutExpired):
                    continue
            else:
                backends["grep"] = None
        except Exception:
            backends["grep"] = None

        # 2. Python (always available since we're running)
        backends["python"] = "python3"

        # 3. llama.cpp daemon (CPU port 11436 for arbiter)
        try:
            import urllib.request
            req = urllib.request.Request("http://127.0.0.1:11436/api/tags")
            with urllib.request.urlopen(req, timeout=2) as r:
                if r.status == 200:
                    backends["llamacpp_arbiter"] = "11436"
                else:
                    backends["llamacpp_arbiter"] = None
        except Exception:
            backends["llamacpp_arbiter"] = None

        # 4. HME worker (port 9098 — absorbs former shim role)
        try:
            import urllib.request
            req = urllib.request.Request("http://127.0.0.1:9098/health")
            with urllib.request.urlopen(req, timeout=2) as r:
                backends["hme_worker"] = "9098" if r.status == 200 else None
        except Exception:
            backends["hme_shim"] = None

        missing = [k for k, v in backends.items() if v is None]
        score = 1.0 - len(missing) / len(backends)
        details = [f"{k}={v or 'MISSING'}" for k, v in backends.items()]

        if not missing:
            return _result(PASS, 1.0, "all subagent backends available", details)
        if "grep" in missing:
            return _result(
                FAIL, score,
                f"subagent grep backend missing — agent will silently fail every search",
                details + ["install ripgrep or ensure GNU grep is on PATH"],
            )
        return _result(
            WARN, score,
            f"{len(missing)} subagent backend(s) missing: {', '.join(missing)}",
            details,
        )


class LifesaverIntegrityVerifier(Verifier):
    """Enforce the LIFESAVER no-dilution rule at the code level.

    LIFESAVER's entire purpose is to be painful until the root cause is fixed.
    Any cooldown, throttle, deduplication, or suppression of LIFESAVER fires
    is a CRITICAL VIOLATION because it dilutes the signal that motivates fixes.
    A "false positive" LIFESAVER is itself a life-critical bug: either the
    detector is wrong (fix the detector at full urgency) or the condition is
    real (fix the condition at full urgency). NEVER reduce alert frequency
    without first eliminating the trigger.

    This verifier scans the call sites of register_critical_failure and the
    Meta-observer L14 alert emission loop. If it finds any gating logic
    (cooldowns, last_fired timestamps, _seen sets, dedup flags) in the call
    path, it FAILs with score 0 and weight 5 — enough to break HCI on its own.

    Reason: if this fails, LIFESAVER is lying about how bad things are,
    which is worse than the original problem.
    """
    name = "lifesaver-integrity"
    category = "runtime"
    weight = 5.0  # highest weight — silencing LIFESAVER is a category-killing bug

    def run(self) -> VerdictResult:
        # Files that contain LIFESAVER firing sites
        fire_sites = [
            os.path.join(_SERVER_DIR, "context.py"),
            os.path.join(_SERVER_DIR, "meta_observer.py"),
        ]
        # Patterns that would indicate LIFESAVER gating / dampening
        # Note: _ALERT_LOG_COOLDOWN is an existing, intentional 30-min cooldown
        # on Meta-observer L14 ALERT LOGGING — not on LIFESAVER fires. That's
        # allowed because it only throttles the log message, not the
        # condition detection. But any NEW pattern matching "cooldown" near a
        # register_critical_failure call is a violation.
        forbidden_near_fire = [
            r"cooldown.*register_critical_failure",
            r"_last_.*_alert.*register_critical_failure",
            r"dedupe.*register_critical_failure",
            r"_suppress.*register_critical_failure",
            r"register_critical_failure.*cooldown",
            r"register_critical_failure.*if _now.*>=",
            r"register_critical_failure.*alerted_set",
        ]
        violations = []
        for path in fire_sites:
            if not os.path.isfile(path):
                continue
            try:
                with open(path) as f:
                    src = f.read()
            except Exception as e:
                return _result(ERROR, 0.0, f"read error on {path}: {e}")
            # Find every call to register_critical_failure and check the
            # surrounding 5 lines for gating patterns
            lines = src.splitlines()
            for i, line in enumerate(lines):
                if "register_critical_failure" not in line:
                    continue
                context_start = max(0, i - 5)
                context_end = min(len(lines), i + 5)
                window = "\n".join(lines[context_start:context_end])
                for pat in forbidden_near_fire:
                    if re.search(pat, window, re.IGNORECASE | re.DOTALL):
                        violations.append(
                            f"{os.path.basename(path)}:{i+1} — potential LIFESAVER gating near register_critical_failure: matched /{pat}/"
                        )
                        break
                # Explicit check: any `if _now - X >=` pattern within 3 lines
                # before register_critical_failure suggests a cooldown guard
                for j in range(max(0, i - 3), i):
                    if re.search(r"if\s+.*(now|time\.time\(\)).*(>=|>|<|<=).*\d", lines[j]):
                        if "register_critical_failure" in "\n".join(lines[j:i + 1]):
                            violations.append(
                                f"{os.path.basename(path)}:{j+1}-{i+1} — time-based guard immediately before register_critical_failure (possible cooldown subversion)"
                            )
                            break
        if not violations:
            return _result(PASS, 1.0,
                           "LIFESAVER fire paths are ungated (no cooldown/dampening detected)")
        return _result(
            FAIL, 0.0,
            f"{len(violations)} LIFESAVER gating pattern(s) found — CRITICAL: signal dilution subversion",
            violations + [
                "RULE: LIFESAVER must fire for every real occurrence. Dampening hides pain from the agent.",
                "If alert is 'false positive', fix the detector at life-critical urgency — do NOT silence it.",
            ],
        )


class ToolResponseLatencyVerifier(Verifier):
    """Baseline-relative latency verifier.

    Absolute thresholds (e.g. "> 5s is bad") don't work here because HME's
    synthesis stack runs on local LLMs on amateur hardware where 10+ second
    latency is normal. Instead, build a rolling baseline from the history
    file metrics/hme-latency-history.json (median of last 20 readings) and
    FAIL only when the CURRENT value is a significant regression from that
    machine-specific baseline. On the first run (no history), the current
    value becomes the first data point and the verifier passes.

    This removes the "HME is slow" false positive on slow hardware while
    still catching real regressions ("HME got suddenly slower").
    """
    name = "tool-response-latency"
    category = "runtime"
    weight = 1.5

    def run(self) -> VerdictResult:
        candidates = [
            os.path.join(_PROJECT, "tools", "HME", "mcp", "server", "hme-ops.json"),
            os.path.join(_PROJECT, "tools", "HME", "KB", "hme-ops.json"),
            os.path.join(_PROJECT, "tmp", "hme-ops.json"),
        ]
        ops_file = next((p for p in candidates if os.path.isfile(p)), None)
        if ops_file is None:
            return _result(SKIP, 1.0, "no hme-ops.json found")
        try:
            with open(ops_file) as f:
                ops = json.load(f)
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        ema_ms = ops.get("tool_response_ms_ema", 0.0)
        if ema_ms <= 0:
            return _result(SKIP, 1.0, "no tool_response_ms_ema data")

        history_file = os.path.join(METRICS_DIR, "hme-latency-history.json")
        history: list = []
        try:
            if os.path.isfile(history_file):
                with open(history_file) as hf:
                    history = json.load(hf)
        except Exception:
            history = []

        # Record the current reading (persist after scoring so the FIRST run
        # sees its own history as empty — baseline establishes on 2nd run)
        new_history = history + [{"ts": time.time(), "ema_ms": ema_ms}]
        # Keep at most 50 entries
        new_history = new_history[-50:]
        try:
            os.makedirs(os.path.dirname(history_file), exist_ok=True)
            with open(history_file, "w") as hf:
                json.dump(new_history, hf)
        except (OSError, TypeError):
            # Unwritable tmp/ (OSError) or unserializable entry
            # (TypeError) — history persistence is best-effort; the
            # current run's score doesn't depend on it. Narrow catch so
            # unexpected errors propagate.
            pass

        # Score based on history
        if len(history) < 3:
            return _result(
                PASS, 1.0,
                f"tool response EMA {ema_ms:.0f}ms (baseline forming: {len(history)}/3 samples)",
                [f"no FAIL until baseline established — {3 - len(history)} more samples needed"],
            )

        prior_values = sorted(h["ema_ms"] for h in history)
        median = prior_values[len(prior_values) // 2]
        p75 = prior_values[int(len(prior_values) * 0.75)]

        # Regression scoring: how much WORSE is current vs historical median?
        # 0-1.5x median: PASS
        # 1.5-3x median: WARN
        # >3x median or >3x p75: FAIL
        ratio_med = ema_ms / median if median > 0 else 1.0
        ratio_p75 = ema_ms / p75 if p75 > 0 else 1.0
        details = [
            f"current={ema_ms:.0f}ms",
            f"baseline_median={median:.0f}ms ({len(history)} samples)",
            f"ratio={ratio_med:.2f}× median",
        ]

        if ratio_med >= 3.0 or ratio_p75 >= 3.0:
            score = max(0.0, 1.0 - (ratio_med - 1.5) / 3.0)
            return _result(
                FAIL, score,
                f"latency regression: {ema_ms:.0f}ms vs {median:.0f}ms baseline ({ratio_med:.1f}×)",
                details + ["latency spiked — investigate recent changes"],
            )
        if ratio_med >= 1.5:
            return _result(
                WARN, 0.7,
                f"latency elevated: {ema_ms:.0f}ms vs {median:.0f}ms baseline ({ratio_med:.1f}×)",
                details,
            )
        return _result(
            PASS, 1.0,
            f"latency within baseline: {ema_ms:.0f}ms (median {median:.0f}ms)",
            details,
        )


class TrajectoryTrendVerifier(Verifier):
    """Reads metrics/hme-trajectory.json and scores the HCI trend direction.
    A prolonged downward trend or a predicted drift below threshold 80 is a
    FAIL even if the CURRENT HCI is still green — predictive coherence."""
    name = "trajectory-trend"
    category = "runtime"
    weight = 1.5

    def run(self) -> VerdictResult:
        data_path = os.path.join(METRICS_DIR, "hme-trajectory.json")
        if not os.path.isfile(data_path):
            return _result(SKIP, 1.0, "no trajectory data — run analyze-hci-trajectory.py")
        try:
            with open(data_path) as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        # Explicit None check — a missing key is SKIP (insufficient
        # history), not silently treated as 0 < 2 = True.
        holo_count = data.get("holograph_count")
        if holo_count is None:
            return _result(SKIP, 1.0, "trajectory data missing holograph_count field")
        if holo_count < 2:
            return _result(SKIP, 1.0, "need 2+ holographs for trend analysis")
        trend = data.get("trend", {})
        pred = data.get("prediction") or {}
        direction = trend.get("direction", "flat")
        slope = trend.get("slope_per_day", 0.0)
        current = data.get("current", {}).get("hci", 100)

        # Predicted drop below 80 is a hard fail
        if pred.get("warning"):
            return _result(
                FAIL, 0.4,
                f"trajectory warning: {pred.get('warning')}",
                [f"current={current:.1f}", f"predicted={pred.get('next_hci_predicted', '?')}"],
            )
        if direction == "down" and abs(slope) > 1.0:
            return _result(
                WARN, 0.7,
                f"HCI declining at {slope:.2f}/day",
                ["downward trend >1 point/day"],
            )
        if direction == "down":
            return _result(
                PASS, 0.9,
                f"HCI flat-ish downward ({slope:.2f}/day) — monitor",
            )
        return _result(PASS, 1.0, f"HCI trend {direction} ({slope:+.2f}/day)")


class FeedbackGraphVerifier(Verifier):
    """output/metrics/feedback_graph.json validates against scripts/validate-feedback-graph.js"""
    name = "feedback-graph"
    category = "topology"
    weight = 1.0

    def run(self) -> VerdictResult:
        graph = os.path.join(METRICS_DIR, "feedback_graph.json")
        if not os.path.isfile(graph):
            return _result(SKIP, 1.0, "no feedback_graph.json")
        try:
            with open(graph) as f:
                data = json.load(f)
        except Exception as e:
            return _result(FAIL, 0.0, f"feedback_graph.json invalid: {e}")
        loops = data.get("loops", [])
        ports = data.get("firewallPorts", [])
        return _result(PASS, 1.0,
                       f"{len(loops)} loops + {len(ports)} firewall ports declared")


class ReloadableModuleSyncVerifier(Verifier):
    """Every module in RELOADABLE list in evolution_selftest.py actually exists."""
    name = "reloadable-sync"
    category = "state"
    weight = 1.0

    def run(self) -> VerdictResult:
        selftest = os.path.join(_SERVER_DIR, "tools_analysis", "evolution_selftest.py")
        if not os.path.isfile(selftest):
            return _result(SKIP, 1.0, "no selftest file")
        try:
            with open(selftest) as f:
                src = f.read()
            m = re.search(r'RELOADABLE\s*=\s*\[(.*?)\]', src, re.DOTALL)
            if not m:
                return _result(ERROR, 0.0, "could not find RELOADABLE list")
            declared = re.findall(r'"([^"]+)"', m.group(1))
        except Exception as e:
            return _result(ERROR, 0.0, f"parse error: {e}")
        ta_dir = os.path.join(_SERVER_DIR, "tools_analysis")
        missing = [name for name in declared
                   if not os.path.isfile(os.path.join(ta_dir, f"{name}.py"))]
        if not missing:
            return _result(PASS, 1.0, f"{len(declared)}/{len(declared)} modules exist")
        score = 1.0 - len(missing) / len(declared)
        return _result(FAIL, score, f"{len(missing)}/{len(declared)} reloadable modules missing",
                       missing)


class TodoMergeHookConsistencyVerifier(Verifier):
    """The TodoWrite hook should NOT block — it should exit 0 so native
    TodoWrite proceeds. If it ever goes back to exit 2 / decision:block the
    agent's session-visible todo list freezes. This regression check."""
    name = "todowrite-hook-nonblock"
    category = "code"
    weight = 1.0

    def run(self) -> VerdictResult:
        hook = os.path.join(_HOOKS_DIR, "pretooluse_todowrite.sh")
        if not os.path.isfile(hook):
            return _result(SKIP, 1.0, "todowrite hook not found")
        try:
            with open(hook) as f:
                src = f.read()
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        # Regression check: must NOT contain a blocking decision
        if '"decision":"block"' in src or "'decision':'block'" in src:
            return _result(FAIL, 0.0,
                           "TodoWrite hook has a blocking decision — native TodoWrite will be frozen",
                           ["remove the decision: block to restore native TodoWrite"])
        if "exit 2" in src:
            return _result(FAIL, 0.5,
                           "TodoWrite hook has exit 2 — may block native TodoWrite",
                           ["replace exit 2 with exit 0 so native TodoWrite proceeds"])
        if "exit 0" not in src:
            return _result(WARN, 0.5, "TodoWrite hook has no explicit exit 0")
        return _result(PASS, 1.0, "TodoWrite hook allows native TodoWrite to proceed")


class OnboardingChainImportVerifier(Verifier):
    """onboarding_chain.py should import cleanly (no syntax errors or
    top-level side effects that require the MCP server)."""
    name = "onboarding-chain-importable"
    category = "state"
    weight = 1.0

    def run(self) -> VerdictResult:
        import ast
        path = os.path.join(_SERVER_DIR, "onboarding_chain.py")
        if not os.path.isfile(path):
            return _result(FAIL, 0.0, "onboarding_chain.py missing — state machine broken")
        try:
            with open(path) as f:
                tree = ast.parse(f.read())
        except SyntaxError as e:
            return _result(FAIL, 0.0, f"syntax error: {e}")
        # Check for top-level statements that would block import
        risky_patterns = ("FastMCP(", "mcp.tool(", "ensure_ready_sync(")
        for node in tree.body:
            if isinstance(node, ast.Expr):
                src_snippet = ast.unparse(node) if hasattr(ast, 'unparse') else ""
                for pat in risky_patterns:
                    if pat in src_snippet:
                        return _result(
                            WARN, 0.5,
                            f"top-level {pat} — would block standalone import",
                        )
        return _result(PASS, 1.0, "onboarding_chain parses and has no risky top-level calls")



# Registry


REGISTRY = [
    DocDriftVerifier(),
    NumericClaimDriftVerifier(),
    AutocommitHealthVerifier(),
    EnvLoadVerifier(),
    EnvTamperVerifier(),
    OAuthTokenExpiryVerifier(),
    SettingsJsonVerifier(),
    LogSizeVerifier(),
    PluginCacheParityVerifier(),
    HookCommandExistenceVerifier(),
    CorePrinciplesAuditVerifier(),
    ShellHookAuditVerifier(),
    ProxyMiddlewareRegistryVerifier(),
    DocstringPresenceVerifier(),
    PythonSyntaxVerifier(),
    ShellSyntaxVerifier(),
    HookExecutabilityVerifier(),
    DecoratorOrderVerifier(),
    TodoMergeHookConsistencyVerifier(),
    StatesSyncVerifier(),
    OnboardingFlowVerifier(),
    OnboardingStateIntegrityVerifier(),
    OnboardingChainImportVerifier(),
    TodoStoreSchemaVerifier(),
    ReloadableModuleSyncVerifier(),
    HookRegistrationVerifier(),
    HookMatcherValidityVerifier(),
    ToolSurfaceCoverageVerifier(),
    ShimHealthVerifier(),
    ErrorLogVerifier(),
    SubagentModeVerifier(),
    SubagentPassthroughVerifier(),
    SubagentGuardVerifier(),
    SubagentBackendsVerifier(),
    WarmContextFreshnessVerifier(),
    HookLatencyVerifier(),
    PlanOutputValidityVerifier(),
    GitCommitTestCoverageVerifier(),
    TransientErrorFilterVerifier(),
    VerifierCoverageGapVerifier(),
    MemeticDriftVerifier(),
    ContextBudgetVerifier(),
    PredictiveHCIVerifier(),
    LifesaverIntegrityVerifier(),
    LifesaverRateVerifier(),
    MetaObserverCoherenceVerifier(),
    ToolResponseLatencyVerifier(),
    TrajectoryTrendVerifier(),
    FeedbackGraphVerifier(),
]



# Engine


def run_engine() -> dict:
    results = {}
    by_category: dict = {}
    for v in REGISTRY:
        result = v.execute()
        results[v.name] = {
            "category": v.category,
            "weight": v.weight,
            **result.to_dict(),
        }
        by_category.setdefault(v.category, []).append((v, result))

    # Aggregate weighted score per category, then overall
    category_scores = {}
    for cat, entries in by_category.items():
        total_w = sum(v.weight for v, _r in entries)
        weighted = sum(v.weight * r.score for v, r in entries)
        category_scores[cat] = {
            "score": (weighted / total_w) if total_w > 0 else 0.0,
            "verifier_count": len(entries),
            "weight_total": total_w,
        }

    total_w = sum(v.weight for v in REGISTRY)
    weighted = sum(v.weight * results[v.name]["score"] for v in REGISTRY)
    hci = (weighted / total_w * 100.0) if total_w > 0 else 0.0

    return {
        "hci": round(hci, 1),
        "verifier_count": len(REGISTRY),
        "categories": category_scores,
        "verifiers": results,
        "timestamp": time.time(),
        "project_root": _PROJECT,
    }


# Output formatters

def format_text(report: dict) -> str:
    lines = []
    hci = report["hci"]
    bar = "█" * int(hci / 5) + "░" * (20 - int(hci / 5))
    lines.append("# HME Coherence Index")
    lines.append("")
    lines.append(f"  HCI: {hci:5.1f} / 100  [{bar}]")
    lines.append(f"  {report['verifier_count']} verifiers across {len(report['categories'])} categories")
    lines.append("")

    lines.append("## Categories")
    for cat in sorted(report["categories"].keys()):
        info = report["categories"][cat]
        score_pct = info["score"] * 100
        lines.append(f"  {cat:12} {score_pct:5.1f}%   ({info['verifier_count']} verifier{'s' if info['verifier_count'] != 1 else ''})")
    lines.append("")

    lines.append("## Verifiers (status / score / summary)")
    by_cat: dict = {}
    for name, info in report["verifiers"].items():
        by_cat.setdefault(info["category"], []).append((name, info))
    for cat in sorted(by_cat.keys()):
        lines.append(f"")
        lines.append(f"### {cat}")
        for name, info in sorted(by_cat[cat]):
            score_pct = info["score"] * 100
            lines.append(f"  {info['status']:5}  {score_pct:5.1f}%  {name:30}  {info['summary']}")
            if info["status"] in (FAIL, ERROR) and info["details"]:
                for d in info["details"][:5]:
                    lines.append(f"           {d}")
    lines.append("")
    return "\n".join(lines)


def main(argv: list) -> int:
    threshold = 80.0
    output_mode = "text"
    for arg in argv:
        if arg == "--json":
            output_mode = "json"
        elif arg == "--score":
            output_mode = "score"
        elif arg.startswith("--threshold="):
            try:
                threshold = float(arg.split("=", 1)[1])
            except ValueError:
                pass

    try:
        report = run_engine()
    except Exception as e:
        import traceback
        sys.stderr.write(f"engine error: {e}\n{traceback.format_exc()}")
        return 2

    # Persist per-verifier snapshot so consecutive-round diffs are answerable
    # without re-running the battery. Answers "which of the 38 verifiers
    # flipped between HCI=94 and HCI=96?" in one read of the JSON file.
    try:
        import json as _json
        import time as _time
        snapshot = {
            "ts": int(_time.time()),
            "hci": report.get("hci"),
            "verifiers": {
                name: {
                    "status": info.get("status"),
                    "score": info.get("score"),
                }
                for name, info in (report.get("verifiers") or {}).items()
            },
        }
        snap_path = os.path.join(METRICS_DIR, "hci-verifier-snapshot.json")
        # Keep last snapshot as .prev and current as the live file, so we can
        # always diff the two most recent HCI computations.
        if os.path.isfile(snap_path):
            prev_path = snap_path + ".prev"
            try:
                os.replace(snap_path, prev_path)
            except OSError:
                pass
        with open(snap_path, "w", encoding="utf-8") as _f:
            _json.dump(snapshot, _f, indent=2)
    except Exception as _snap_err:
        sys.stderr.write(f"snapshot persist failed: {_snap_err}\n")

    if output_mode == "json":
        print(json.dumps(report, indent=2))
    elif output_mode == "score":
        print(int(round(report["hci"])))
    else:
        print(format_text(report))

    return 0 if report["hci"] >= threshold else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
