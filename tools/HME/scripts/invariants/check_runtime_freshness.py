#!/usr/bin/env python3
"""Validate runtime freshness/context thermodynamics config and guard coverage."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[4])
CONFIG = ROOT / "tools/HME/config/runtime-freshness.json"
READ_POLICY = ROOT / "tools/HME/proxy/read_policy.js"


def main() -> int:
    findings: list[str] = []
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    if cfg.get("schema") != 1:
        findings.append("runtime-freshness schema must be 1")
    windows = cfg.get("freshness_windows_sec")
    if not isinstance(windows, dict) or not windows:
        findings.append("freshness_windows_sec must be nonempty object")
    else:
        for key, val in sorted(windows.items()):
            if not isinstance(val, int) or val <= 0 or val > 86400:
                findings.append(f"{key}: freshness window must be 1..86400 sec")
    ac = cfg.get("autocommit_error_freshness")
    if not isinstance(ac, dict):
        findings.append("autocommit_error_freshness must be object")
    else:
        window_key = ac.get("window_key")
        if window_key not in (windows or {}):
            findings.append("autocommit_error_freshness.window_key must reference freshness_windows_sec")
        for key in ("current_label", "historical_label"):
            if not isinstance(ac.get(key), str) or not ac[key].strip():
                findings.append(f"autocommit_error_freshness.{key} must be nonempty string")
        if ac.get("current_label") == ac.get("historical_label"):
            findings.append("autocommit current/historical labels must differ")
        ts_sources = ac.get("timestamp_sources")
        if not isinstance(ts_sources, list) or {"fail-flag-body-iso8601", "fail-flag-mtime"} - set(ts_sources or []):
            findings.append("autocommit_error_freshness.timestamp_sources must include body timestamp and mtime")
        live_modules = ac.get("live_alert_modules")
        if not isinstance(live_modules, list) or not live_modules:
            findings.append("autocommit_error_freshness.live_alert_modules must be nonempty list")
        else:
            for rel in live_modules:
                if not isinstance(rel, str) or not rel:
                    findings.append("autocommit_error_freshness.live_alert_modules entries must be nonempty strings")
                    continue
                text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
                if str(ac.get("current_label") or "") not in text or str(ac.get("historical_label") or "") not in text:
                    findings.append(f"{rel} must emit both autocommit freshness labels")
    entropy = cfg.get("context_entropy")
    if not isinstance(entropy, dict):
        findings.append("context_entropy must be object")
    else:
        if entropy.get("forbidden_task_output_path_pattern") != "TMP_CLAUDE_TASK_OUTPUT_GLOB":
            findings.append("forbidden_task_output_path_pattern must use tokenized TMP_CLAUDE_TASK_OUTPUT_GLOB")
        if not isinstance(entropy.get("max_duplicate_hook_banner"), int) or entropy["max_duplicate_hook_banner"] < 0:
            findings.append("max_duplicate_hook_banner must be nonnegative integer")
        if entropy.get("stale_log_requires_label") is not True:
            findings.append("stale_log_requires_label must be true")
    read_policy = READ_POLICY.read_text(encoding="utf-8", errors="replace")
    if "background task-output polling is context-burn" not in read_policy:
        findings.append("read_policy.js must block task-output polling with context-burn reason")
    if "tasks\\/[^/]+\\.output" not in read_policy and "tasks\\/[^/]+\\.output" not in read_policy.replace("", "\\"):
        findings.append("read_policy.js must recognize task output paths")
    for row in findings:
        print(row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
