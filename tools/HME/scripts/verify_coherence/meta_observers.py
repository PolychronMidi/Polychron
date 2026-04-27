"""Meta-observer, verifier-coverage, memetic drift, predictive HCI."""
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


class MetaObserverCoherenceVerifier(Verifier):
    """Scores meta-observer L14 alerts using the ACUTE (1h) window. Historical
    alerts in the 6h and 24h windows contribute weakly — the focus is on
    whether HME is currently unstable."""
    name = "meta-observer-coherence"
    category = "runtime"
    subtag = "drift-detection"
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


class VerifierCoverageGapVerifier(Verifier):
    """H13 consumer: reads metrics/hme-verifier-coverage.json and flags
    gaps — fix commits with no matching verifier. Low weight because
    this is aspirational."""
    name = "verifier-coverage-gap"
    category = "runtime"
    subtag = "interface-contract"
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
    subtag = "drift-detection"
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


class PredictiveHCIVerifier(Verifier):
    """H9: consumes metrics/hme-hci-forecast.json (produced by predict-hci.py)
    and scores based on predicted drift. This is the forward-looking layer —
    fire a WARN when HCI is projected to cross the 80 threshold before it
    actually does, so the agent has time to fix whatever's driving the drop."""
    name = "predictive-hci"
    category = "runtime"
    subtag = "regression-prevention"
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


