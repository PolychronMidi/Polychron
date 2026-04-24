"""Autocommit and shim health verifiers."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

from ._base import (
    Verifier, VerdictResult, _result, _run_subprocess,
    PASS, WARN, FAIL, SKIP, ERROR,
    _PROJECT, _HOOKS_DIR, _SERVER_DIR, _SCRIPTS_DIR, _DOC_DIRS, METRICS_DIR,
)


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


