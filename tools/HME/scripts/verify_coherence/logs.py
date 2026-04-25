"""Log-size, error-log, lifesaver-rate verifiers."""
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


class PipelineBgScriptHealthVerifier(Verifier):
    """Surfaces silent failures from main-pipeline.js's bg-spawn analytics.

    Each background script (snapshot-holograph, analyze-tool-effectiveness,
    etc.) writes its stderr to log/hme-bg-<name>.err — truncated each round.
    A non-empty file means the script crashed during the most recent pipeline
    run. Until this verifier existed those errors went unread; the loop was
    visible only as days-stale metrics that nobody traced back to the
    originating spawn (the bug class fixed in the METRICS_DIR-undefined
    sweep). This verifier closes that loop.

    PASS:  no .err files OR all empty
    WARN:  1-2 scripts with non-empty stderr (transient)
    FAIL:  3+ scripts failing (substrate-wide regression)
    """
    name = "pipeline-bg-script-health"
    category = "state"
    weight = 1.5

    def run(self) -> VerdictResult:
        log_dir = os.path.join(_PROJECT, "log")
        if not os.path.isdir(log_dir):
            return _result(SKIP, 1.0, "log/ dir missing")
        try:
            err_files = [
                f for f in os.listdir(log_dir)
                if f.startswith("hme-bg-") and f.endswith(".err")
            ]
        except OSError as e:
            return _result(ERROR, 0.0, f"listdir failed: {e}")
        if not err_files:
            return _result(SKIP, 1.0, "no hme-bg-*.err files yet — pipeline hasn't run since hardening")
        failing = []
        for name in sorted(err_files):
            path = os.path.join(log_dir, name)
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            if size == 0:
                continue
            # Read first ~400 bytes for a snippet.
            snippet = ""
            try:
                with open(path) as f:
                    snippet = f.read(400).strip().replace("\n", " | ")
            except OSError:
                pass
            script = name[len("hme-bg-"):-len(".err")]
            failing.append((script, size, snippet))
        total = len(err_files)
        if not failing:
            return _result(PASS, 1.0, f"{total}/{total} bg scripts ran clean")
        score = max(0.0, 1.0 - len(failing) / max(total, 1))
        details = [f"{s} ({sz}B): {snip[:160]}" for s, sz, snip in failing]
        verdict = FAIL if len(failing) >= 3 else WARN
        return _result(
            verdict, score,
            f"{len(failing)}/{total} bg scripts failed last pipeline run",
            details,
        )


