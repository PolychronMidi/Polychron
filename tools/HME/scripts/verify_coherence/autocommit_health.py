"""Autocommit and worker health verifiers."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

import datetime
import urllib.request

from ._base import (
    ERROR,
    FAIL,
    METRICS_DIR,
    PASS,
    SKIP,
    VerdictResult,
    Verifier,
    WARN,
    _DOC_DIRS,
    _HOOKS_DIR,
    _PROJECT,
    _SCRIPTS_DIR,
    _SERVER_DIR,
    _result,
    _run_subprocess,
    failed,
    passed,
    register,
    warned,
)


@register
class AutocommitHealthVerifier(Verifier):
    """Autocommit must succeed every attempt. Catastrophic silent failure
    has been observed -- autocommits dying without a single LIFESAVER
    alert, because the original failure path depended on the very
    environment that was broken.

    The _autocommit.sh helper now records every failure to four
    independent channels (sticky fail flag, hme-errors.log, stderr,
    activity bridge). This verifier checks the most durable of those --
    the sticky fail flag and the attempt counter under tmp/ -- which are
    independent of PROJECT_ROOT, .env loading, log-dir writability, and
    adapter stderr filtering. FAILs at weight 5.0 (same tier as
    LifesaverIntegrity) because autocommit going silent is the exact
    structural-dampening failure mode that weight exists for."""
    name = "autocommit-health"
    category = "state"
    subtag = "structural-integrity"
    weight = 5.0

    def run(self) -> VerdictResult:
        import datetime
        state_dir = os.path.join(_PROJECT, "tools", "HME", "runtime")
        fail_flag = os.path.join(state_dir, "autocommit.fail")
        counter_file = os.path.join(state_dir, "autocommit.counter")
        last_ok_file = os.path.join(state_dir, "autocommit.last-success")
        heartbeat_file = os.path.join(state_dir, "heartbeat-autocommit.ts")

        issues = []

        # 1. Sticky fail flag -- exists iff last autocommit failed.
        if os.path.isfile(fail_flag):
            try:
                with open(fail_flag) as f:
                    issues.append(f"fail flag set: {f.read().strip()[:240]}")
            except OSError as e:
                issues.append(f"fail flag exists but unreadable: {e}")

        # 2. Attempt counter -- monotonic increment on every attempt, reset
        # on success. 3+ attempts without a reset = wedged state.
        if os.path.isfile(counter_file):
            try:
                with open(counter_file) as f:
                    raw = f.read().strip()
            except OSError as e:
                issues.append(f"counter file unreadable: {e}")
            else:
                # Empty-file and non-numeric content are separate real
                if not raw:
                    pass
                else:
                    try:
                        n = int(raw)
                    except ValueError:
                        issues.append(f"counter file has non-numeric content: {raw[:40]!r}")
                    else:
                        if n >= 3:
                            issues.append(f"attempt counter at {n} (>=3 attempts without success)")

        # 3. Last-success freshness -- if the repo has a .git and history
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

        # 4. Active dirty worktree + stale heartbeat means the request/hook
        # path stopped running even if no sticky fail flag was left behind.
        try:
            dirty = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=_PROJECT,
                text=True,
                capture_output=True,
                timeout=5,
            )
            worktree_dirty = dirty.returncode != 0 or bool(dirty.stdout.strip())
        except Exception:
            worktree_dirty = True
        if worktree_dirty:
            max_age = float(os.environ.get("HME_AUTOCOMMIT_ACTIVE_MAX_AGE_SEC", 6 * 60 * 60))
            try:
                age = time.time() - os.path.getmtime(heartbeat_file)
            except OSError:
                issues.append("autocommit heartbeat missing while worktree is dirty")
            else:
                if age > max_age:
                    issues.append(f"autocommit heartbeat stale while worktree is dirty ({age/3600:.1f}h > {max_age/3600:.1f}h)")

        if not issues:
            return passed(summary="autocommit operational")
        # FAIL with score 0: weight 5.0 means any failure here hits the
        # HCI hard, same tier as LifesaverIntegrity. That's the contract.
        return failed(summary=f"autocommit unhealthy ({len(issues)} issue(s))", details=issues)


@register
class ShimHealthVerifier(Verifier):
    name = "worker-health"
    category = "runtime"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        try:
            import urllib.request
            sys.path.insert(0, _SCRIPTS_DIR)
            from service_registry import service_map, service_url
            req = urllib.request.Request(service_url(service_map()["worker"]))
            with urllib.request.urlopen(req, timeout=2) as r:
                if r.status == 200:
                    return passed(summary="worker /health responds 200")
                return warned(summary=f"worker /health returned {r.status}")
        except Exception as e:
            return warned(score=0.0, summary=f"worker unreachable: {type(e).__name__}", details=[str(e)])
