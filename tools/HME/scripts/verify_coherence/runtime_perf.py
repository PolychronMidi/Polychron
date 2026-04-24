"""Runtime perf: hook latency, tool-response latency, git commit coverage."""
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


