"""Lifesaver integrity + trajectory trend."""
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


