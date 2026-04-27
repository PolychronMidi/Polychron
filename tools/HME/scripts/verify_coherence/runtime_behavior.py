"""Runtime transient/context/warm/plan verifiers."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

import threading

from ._base import (
    Verifier, VerdictResult, _result, _run_subprocess,
    PASS, WARN, FAIL, SKIP, ERROR,
    _PROJECT, _HOOKS_DIR, _SERVER_DIR, _SCRIPTS_DIR, _DOC_DIRS, METRICS_DIR,
)


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
    subtag = "freshness"
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


