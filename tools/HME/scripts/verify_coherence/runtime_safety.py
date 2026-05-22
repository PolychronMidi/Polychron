"""Lifesaver integrity + trajectory trend."""
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


@register
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
    path, it FAILs with score 0 and weight 5 -- enough to break HCI on its own.

    Reason: if this fails, LIFESAVER is lying about how bad things are,
    which is worse than the original problem.
    """
    name = "lifesaver-integrity"
    category = "runtime"
    subtag = "regression-prevention"
    weight = 5.0  # highest weight -- silencing LIFESAVER is a category-killing bug

    def run(self) -> VerdictResult:
        # Files that contain LIFESAVER firing sites
        fire_sites = [
            os.path.join(_SERVER_DIR, "context.py"),
            os.path.join(_SERVER_DIR, "meta_observer.py"),
        ]
        # Patterns that would indicate LIFESAVER gating / dampening
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
                return errored(summary=f"read error on {path}: {e}")
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
                            f"{os.path.basename(path)}:{i+1} -- potential LIFESAVER gating near register_critical_failure: matched /{pat}/"
                        )
                        break
                # Explicit check: any `if _now - X >=` pattern within 3 lines
                # before register_critical_failure suggests a cooldown guard
                for j in range(max(0, i - 3), i):
                    if re.search(r"if\s+.*(now|time\.time\(\)).*(>=|>|<|<=).*\d", lines[j]):
                        if "register_critical_failure" in "\n".join(lines[j:i + 1]):
                            violations.append(
                                f"{os.path.basename(path)}:{j+1}-{i+1} -- time-based guard immediately before register_critical_failure (possible cooldown subversion)"
                            )
                            break
        if not violations:
            return passed(summary="LIFESAVER fire paths are ungated (no cooldown/dampening detected)")
        return failed(summary=f"{len(violations)} LIFESAVER gating pattern(s) found -- CRITICAL: signal dilution subversion", details=violations + [
                "RULE: LIFESAVER must fire for every real occurrence. Dampening hides pain from the agent.",
                "If alert is 'false positive', fix the detector at life-critical urgency -- do NOT silence it.",
            ])


@register
class LifesaverHeartbeatVerifier(Verifier):
    name = "lifesaver-heartbeat"
    category = "runtime"
    subtag = "structural-integrity"
    weight = 5.0

    def run(self) -> VerdictResult:
        heartbeat = os.path.join(_PROJECT, "tools", "HME", "runtime", "heartbeat-lifesaver.ts")
        max_age = float(os.environ.get("HME_LIFESAVER_ACTIVE_MAX_AGE_SEC", 6 * 60 * 60))
        try:
            age = time.time() - os.path.getmtime(heartbeat)
        except OSError:
            return failed(summary="lifesaver heartbeat missing", details=["run a real Claude/Codex request through the proxy; hook/proxy lifesaver route must update tools/HME/runtime/heartbeat-lifesaver.ts"])
        if age > max_age:
            return failed(summary=f"lifesaver heartbeat stale ({age/3600:.1f}h > {max_age/3600:.1f}h)", details=["Stop hooks or proxy lifesaver injection are not reaching the canonical lifesaver route"])
        return passed(summary=f"lifesaver heartbeat fresh ({age:.0f}s)")


@register
class TrajectoryTrendVerifier(Verifier):
    """Reads metrics/hme-trajectory.json and scores the HCI trend direction.
    A prolonged downward trend or a predicted drift below threshold 80 is a
    FAIL even if the CURRENT HCI is still green -- predictive coherence."""
    name = "trajectory-trend"
    category = "runtime"
    subtag = "regression-prevention"
    weight = 1.5

    def run(self) -> VerdictResult:
        data_path = os.path.join(METRICS_DIR, "hme-trajectory.json")
        if not os.path.isfile(data_path):
            return skipped(summary="no trajectory data -- run analyze-hci-trajectory.py")
        try:
            with open(data_path) as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            return errored(summary=f"read error: {e}")
        # Explicit None check -- a missing key is SKIP (insufficient
        # history), not silently treated as 0 < 2 = True.
        holo_count = data.get("holograph_count")
        if holo_count is None:
            return skipped(summary="trajectory data missing holograph_count field")
        if holo_count < 2:
            return skipped(summary="need 2+ holographs for trend analysis")
        trend = data.get("trend", {})
        pred = data.get("prediction") or {}
        direction = trend.get("direction", "flat")
        slope = trend.get("slope_per_day", 0.0)
        current = data.get("current", {}).get("hci", 100)

        # Predicted drop below 80 is a hard fail
        if pred.get("warning"):
            return failed(score=0.4, summary=f"trajectory warning: {pred.get('warning')}", details=[f"current={current:.1f}", f"predicted={pred.get('next_hci_predicted', '?')}"])
        if direction == "down" and abs(slope) > 1.0:
            return warned(score=0.7, summary=f"HCI declining at {slope:.2f}/day", details=["downward trend >1 point/day"])
        if direction == "down":
            return passed(score=0.9, summary=f"HCI flat-ish downward ({slope:.2f}/day) -- monitor")
        return passed(summary=f"HCI trend {direction} ({slope:+.2f}/day)")
