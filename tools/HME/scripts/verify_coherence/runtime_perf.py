"""Runtime perf: hook latency, tool-response latency, git commit coverage."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

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
    errored,
    failed,
    passed,
    register,
    skipped,
    warned,
)


def _recent_service_restart(seconds: int = 300) -> tuple[bool, str]:
    import datetime as _dt
    import urllib.request as _ur
    try:
        port = os.environ['HME_PROXY_PORT']
        with _ur.urlopen(f"http://127.0.0.1:{port}/health", timeout=1) as resp:
            data = json.loads(resp.read().decode())
        raw = data.get("started_at")
        if not raw:
            return False, ""
        ts = _dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp()
        age = time.time() - ts
        return 0 <= age <= seconds, f"proxy restarted {age:.0f}s ago"
    except Exception:
        return False, ""


_LATENCY_EXCLUDED_TOOLS = {"hme_admin", "hme_selftest", "hme_hot_reload"}
_RESP_RE = re.compile(r"RESP\s+(\w+)\s+\[([0-9.]+)s\]")


def _recent_interactive_latency_ms(limit: int = 20) -> float | None:
    path = os.path.join(_PROJECT, "log", "hme.log")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()[-2000:]
    except OSError:
        return None
    values: list[float] = []
    for line in reversed(lines):
        m = _RESP_RE.search(line)
        if not m or m.group(1) in _LATENCY_EXCLUDED_TOOLS:
            continue
        values.append(float(m.group(2)) * 1000)
        if len(values) >= limit:
            break
    if len(values) < 3:
        return None
    values.sort()
    return max(1.0, values[len(values) // 2])


@register
class HookLatencyVerifier(Verifier):
    """H3: flag hooks whose p95 wall-time exceeds a per-hook budget.

    Hook latency is silent tax -- every tool call pays it. A hook that
    regresses from 50ms to 500ms adds half a second to every Edit, which
    compounds across a session. This verifier reads
    log/hme-hook-latency.jsonl (populated by hooks themselves via the
    _timestamp_hook helper) and flags hooks exceeding their budget.

    Per-hook budgets calibrated to legitimate workload:
      - stop:            4000ms -- runs detector chain, autocommit, nexus
                          audit, holograph diff, activity bridge, plus
                          proxy lifecycle dispatch
      - sessionstart:    2500ms -- proxy watchdog (up to 8s on cold spawn,
                          but p50 under 2s), supervisor kickoff, proxy
                          primer flag, holograph snapshot
      - precompact:      2000ms -- chain snapshot + warm-context flush
      - default (else):   500ms -- every other hook should be fast
    """
    name = "hook-latency"
    category = "runtime"
    subtag = "performance"
    weight = 1.0

    # Per-hook budget table. universal_pulse.json hook_thresholds is the
    _FALLBACK_BUDGETS = {
        "stop":             900,
        "sessionstart":    2500,
        "userpromptsubmit": 700,
        "precompact":      2000,
    }
    _DEFAULT_BUDGET = 500

    def _load_budgets(self):
        cfg_path = os.path.join(_PROJECT, "tools", "HME", "config", "universal_pulse.json")
        try:
            with open(cfg_path) as f:
                cfg = json.load(f)
            for probe in cfg.get("hook_latency_probes", []):
                thresholds = probe.get("hook_thresholds")
                if isinstance(thresholds, dict) and thresholds:
                    return {k: float(v) for k, v in thresholds.items()}
        except (OSError, ValueError, KeyError):
            pass  # silent-ok: best-effort fs op
        return dict(self._FALLBACK_BUDGETS)

    def _budget_for(self, hook_name):
        budgets = getattr(self, "_cached_budgets", None)
        if budgets is None:
            budgets = self._load_budgets()
            self._cached_budgets = budgets
        # Exact match first.
        if hook_name in budgets:
            return budgets[hook_name]
        # Longest-prefix match (mirrors universal_pulse_tick._resolve_threshold).
        best_key = None
        for key in budgets:
            if hook_name.startswith(key) and (best_key is None or len(key) > len(best_key)):
                best_key = key
        if best_key is not None:
            return budgets[best_key]
        return self._DEFAULT_BUDGET

    def run(self) -> VerdictResult:
        log_path = os.path.join(_PROJECT, "log", "hme-hook-latency.jsonl")
        if not os.path.isfile(log_path):
            return skipped(summary="no hook latency log yet (first run)")
        # Match universal_pulse's rolling-window semantics. The previous
        _WINDOW_SEC = 600
        _cutoff_ts = time.time() - _WINDOW_SEC
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
                    ts = entry.get("ts")
                    if isinstance(ts, (int, float)) and ts < _cutoff_ts:
                        continue
                    by_hook.setdefault(entry.get("hook", "?"), []).append(
                        float(entry.get("duration_ms", 0))
                    )
        except (OSError, ValueError) as e:
            return errored(summary=f"read error: {e}")
        if not by_hook:
            return skipped(summary="log exists but empty")
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
            return passed(summary=f"{total} hooks all within per-hook budget")
        score = max(0.0, 1.0 - len(slow) / total)
        return _result(
            WARN if len(slow) < 3 else FAIL, score,
            f"{len(slow)}/{total} hooks exceed their p95 budget", slow,
        )


@register
class GitCommitTestCoverageVerifier(Verifier):
    """H5: Check that recent 'fix'/'bug' commits add or modify a
    test/verifier in the same commit. Commits that claim fixes without a
    regression guard are a class of drift -- next time the bug comes back
    there's nothing to catch it."""
    name = "git-commit-test-coverage"
    category = "runtime"
    subtag = "interface-contract"
    weight = 0.5

    _FIX_KEYWORDS = ("fix", "bug", "regression", "repair", "patch", "correct", "error")

    def run(self) -> VerdictResult:
        try:
            rc = subprocess.run(
                ["git", "-C", _PROJECT, "log", "--oneline", "-50"],
                capture_output=True, text=True, timeout=3,
            )
            if rc.returncode != 0:
                return skipped(summary="git log failed")
            log_lines = rc.stdout.splitlines()
        except Exception as e:
            return errored(summary=f"git error: {e}")
        fix_commits = []
        for line in log_lines:
            parts = line.split(" ", 1)
            if len(parts) != 2:
                continue
            sha, msg = parts
            if any(kw in msg.lower() for kw in self._FIX_KEYWORDS):
                fix_commits.append((sha, msg))
        if not fix_commits:
            return passed(summary="no fix commits in last 50 -- nothing to check")
        uncovered = []
        for sha, msg in fix_commits[:10]:  # sample last 10 fix commits
            try:
                rc = subprocess.run(
                    ["git", "-C", _PROJECT, "show", "--name-only", "--format=", sha],
                    capture_output=True, text=True, timeout=3,
                )
                files = [f for f in rc.stdout.splitlines() if f.strip()]
            except Exception:
                # silent-ok: optional fallback path.
                continue
            has_test = any(
                ("verify-" in f or "test-" in f or "_test." in f
                 or "stress-test" in f or "verifier" in f.lower())
                for f in files
            )
            if not has_test:
                uncovered.append(f"{sha[:8]} {msg[:60]}")
        if not uncovered:
            return passed(summary=f"{len(fix_commits)} fix commits, all include test/verifier changes")
        # WARN not FAIL -- this is aspirational, not mandatory. Small project
        # code fixes don't always need new tests.
        return warned(score=max(0.0, 1.0 - len(uncovered) / 10.0), summary=f"{len(uncovered)} recent fix commit(s) without a new test/verifier", details=uncovered[:5])


@register
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
    subtag = "performance"
    weight = 1.5

    def run(self) -> VerdictResult:
        candidates = [
            os.path.join(_PROJECT, "tools", "HME", "service", "server", "hme-ops.json"),
            os.path.join(_PROJECT, "tools", "HME", "KB", "hme-ops.json"),
            os.path.join(_PROJECT, "tmp", "hme-ops.json"),
        ]
        ops_file = next((p for p in candidates if os.path.isfile(p)), None)
        if ops_file is None:
            return skipped(summary="no hme-ops.json found")
        try:
            with open(ops_file) as f:
                ops = json.load(f)
        except Exception as e:
            return errored(summary=f"read error: {e}")
        raw_ema_ms = float(ops.get("tool_response_ms_ema", 0.0) or 0.0)
        interactive_ms = _recent_interactive_latency_ms()
        latency_note = ""
        ema_ms = raw_ema_ms
        if interactive_ms is not None and (raw_ema_ms <= 0 or interactive_ms < raw_ema_ms):
            ema_ms = interactive_ms
            latency_note = f"recent interactive median={interactive_ms:.0f}ms"
        if ema_ms <= 0:
            return skipped(summary="no tool_response_ms_ema data")

        history_file = os.path.join(METRICS_DIR, "hme-latency-history.json")
        history: list = []
        try:
            if os.path.isfile(history_file):
                with open(history_file) as hf:
                    history = json.load(hf)
        except Exception:
            # silent-ok: optional fallback path.
            history = []

        # Record the current reading (persist after scoring so the FIRST run
        # sees its own history as empty -- baseline establishes on 2nd run)
        new_history = history + [{"ts": time.time(), "ema_ms": ema_ms}]
        # Keep at most 50 entries
        new_history = new_history[-50:]
        try:
            os.makedirs(os.path.dirname(history_file), exist_ok=True)
            with open(history_file, "w") as hf:
                json.dump(new_history, hf)
        except (OSError, TypeError):
            # Unwritable tmp/ (OSError) or unserializable entry
            pass

        # Score based on history
        if len(history) < 3:
            return passed(summary=f"tool response EMA {ema_ms:.0f}ms (baseline forming: {len(history)}/3 samples)", details=[f"no FAIL until baseline established -- {3 - len(history)} more samples needed"])

        prior_values = sorted(h["ema_ms"] for h in history)
        median = prior_values[len(prior_values) // 2]
        p75 = prior_values[int(len(prior_values) * 0.75)]

        # Regression scoring: how much WORSE is current vs historical median?
        ratio_med = ema_ms / median if median > 0 else 1.0
        ratio_p75 = ema_ms / p75 if p75 > 0 else 1.0
        details = [
            f"current={ema_ms:.0f}ms",
            f"baseline_median={median:.0f}ms ({len(history)} samples)",
            f"ratio={ratio_med:.2f}* median",
        ]
        if latency_note:
            details.append(latency_note)

        if ratio_med >= 3.0 or ratio_p75 >= 3.0:
            recent_restart, restart_detail = _recent_service_restart()
            if recent_restart:
                return warned(score=0.65, summary=f"latency spike during startup grace: {ema_ms:.0f}ms", details=details + [restart_detail])
            recent = [float(h.get("ema_ms", 0)) for h in history[-3:]]
            spike_count = sum(1 for v in recent + [ema_ms] if median > 0 and v / median >= 3.0)
            if spike_count < 2:
                return warned(score=0.65, summary=f"latency spike: {ema_ms:.0f}ms vs {median:.0f}ms baseline", details=details + ["single-sample spike; FAIL requires persistence"])
            score = max(0.0, 1.0 - (ratio_med - 1.5) / 3.0)
            return failed(score=score, summary=f"latency regression: {ema_ms:.0f}ms vs {median:.0f}ms baseline ({ratio_med:.1f}*)", details=details + ["latency spike persisted -- investigate recent changes"])
        if ratio_med >= 1.5:
            return warned(score=0.7, summary=f"latency elevated: {ema_ms:.0f}ms vs {median:.0f}ms baseline ({ratio_med:.1f}*)", details=details)
        return passed(summary=f"latency within baseline: {ema_ms:.0f}ms (median {median:.0f}ms)", details=details)


