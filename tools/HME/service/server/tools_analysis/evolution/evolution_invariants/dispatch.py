"""Invariant dispatcher -- binds evaluator names to check handlers."""
from __future__ import annotations

import json
import logging
import os

from server import context as ctx

logger = logging.getLogger("HME")

from ._base import METRICS_DIR, _load_invariants
from .checks import (
    _check_files_executable, _check_files_referenced, _check_file_exists,
    _check_json_valid, _check_glob_count_gte,
    _check_pattern_in_file, _check_patterns_all_in_file, _check_pattern_count_gte,
    _check_symbols_used, _check_symbols_have_kb, _check_files_mtime_window,
    _check_kb_content_no_pattern, _check_kb_freshness,
    _check_metric_has_variance, _check_metric_threshold, _check_correlation_direction,
    _check_activity_events_balanced, _check_activity_field_sanity,
    _check_same_commit_determinism, _check_invariant_chronically_failing,
    _check_shell_output_empty,
    _check_eslint_concordance_complete,
)


def _eval(inv: dict) -> tuple[bool, str]:
    checkers = {
        "files_executable": _check_files_executable,
        "files_referenced": _check_files_referenced,
        "file_exists": _check_file_exists,
        "json_valid": _check_json_valid,
        "glob_count_gte": _check_glob_count_gte,
        "pattern_in_file": _check_pattern_in_file,
        "patterns_all_in_file": _check_patterns_all_in_file,
        "pattern_count_gte": _check_pattern_count_gte,
        "symbols_used": _check_symbols_used,
        "symbols_have_kb": _check_symbols_have_kb,
        "files_mtime_window": _check_files_mtime_window,
        "kb_content_no_pattern": _check_kb_content_no_pattern,
        "kb_freshness": _check_kb_freshness,
        "metric_has_variance": _check_metric_has_variance,
        "metric_threshold": _check_metric_threshold,
        "correlation_direction": _check_correlation_direction,
        "activity_events_balanced": _check_activity_events_balanced,
        "activity_field_sanity": _check_activity_field_sanity,
        "same_commit_determinism": _check_same_commit_determinism,
        "invariant_chronically_failing": _check_invariant_chronically_failing,
        "shell_output_empty": _check_shell_output_empty,
        "eslint_concordance_complete": _check_eslint_concordance_complete,
    }
    inv_type = inv.get("type", "")
    checker = checkers.get(inv_type)
    if not checker:
        return False, f"unknown type: {inv_type}"
    try:
        return checker(inv)
    except FileNotFoundError as e:
        return False, f"file not found: {e.filename}"
    except Exception as e:
        return False, f"check error: {e}"


def _persist_invariant_history(results: list) -> None:
    """Update metrics/hme-invariant-history.json with pass/fail streaks.
    fail_streaks[id] = consecutive FAILs (reset on PASS, incremented on FAIL).
    last_run tracks most recent timestamp so stale invariants can be detected.
    """
    import json as _json
    import time as _time
    history_path = os.path.join(METRICS_DIR, "hme-invariant-history.json")
    history: dict = {}
    if os.path.isfile(history_path):
        try:
            with open(history_path, encoding="utf-8") as _f:
                history = _json.load(_f) or {}
        except (OSError, _json.JSONDecodeError):
            history = {}
    fail_streaks = history.get("fail_streaks") or {}
    last_result = history.get("last_result") or {}
    # R22 #3: prune entries for invariants that no longer exist in current
    current_ids = {inv.get("id") for (inv, _ok, _d) in results if inv.get("id")}
    for stale in list(fail_streaks.keys()):
        if stale not in current_ids:
            del fail_streaks[stale]
    for stale in list(last_result.keys()):
        if stale not in current_ids:
            del last_result[stale]
    for inv, ok, _detail in results:
        inv_id = inv.get("id", "?")
        if ok:
            fail_streaks[inv_id] = 0
        else:
            fail_streaks[inv_id] = int(fail_streaks.get(inv_id, 0)) + 1
        last_result[inv_id] = "pass" if ok else "fail"
    out = {
        "last_run": int(_time.time()),
        "total_runs": int(history.get("total_runs", 0)) + 1,
        "fail_streaks": fail_streaks,
        "last_result": last_result,
    }
    os.makedirs(os.path.dirname(history_path), exist_ok=True)
    tmp = history_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as _f:
        _json.dump(out, _f, indent=2)
    os.replace(tmp, history_path)


def check_invariants(verbose: bool = False, report_mode: str = "default") -> str:
    """Run the declarative invariant battery from config/invariants.json."""
    try:
        invariants = _load_invariants()
    except Exception as e:
        return f"# Invariant Battery: FAILED TO LOAD\n\nError: {e}"

    if not invariants:
        return "# Invariant Battery: empty\n\nAdd invariants to tools/HME/config/invariants.json"

    results: list[tuple[dict, bool, str]] = []
    for inv in invariants:
        ok, detail = _eval(inv)
        results.append((inv, ok, detail))

    # Persist per-invariant pass/fail history so the chronic-failure check
    try:
        _persist_invariant_history(results)
    except Exception as _hist_err:
        logger.debug(f"invariant history write failed: {type(_hist_err).__name__}: {_hist_err}")

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    parts = [f"# Invariant Battery: {passed}/{total} passed ({total} from invariants.json)\n"]

    errors = [(inv, d) for inv, ok, d in results if not ok and inv.get("severity") == "error"]
    warnings = [(inv, d) for inv, ok, d in results if not ok and inv.get("severity") == "warning"]
    infos = [(inv, d) for inv, ok, d in results if not ok and inv.get("severity") == "info"]
    actionable_warnings = [(inv, d) for inv, d in warnings if inv.get("warning_kind") not in {"stale-data", "informational"}]
    stale_warnings = [(inv, d) for inv, d in warnings if inv.get("warning_kind") in {"stale-data", "informational"}]
    passes = [(inv, d) for inv, ok, d in results if ok]

    if errors:
        parts.append(f"## ERRORS ({len(errors)})\n")
        for inv, detail in errors:
            parts.append(f"  FAIL [{inv['id']}]: {inv['description']}")
            if detail:
                parts.append(f"        {detail}")
        parts.append("")

    if warnings and report_mode == "actionable":
        parts.append(f"## ACTIONABLE WARNINGS ({len(actionable_warnings)})\n")
        if actionable_warnings:
            for inv, detail in actionable_warnings:
                parts.append(f"  WARN [{inv['id']}]: {inv['description']}")
                if detail:
                    parts.append(f"        {detail}")
                if inv.get("repair_command"):
                    parts.append(f"        repair: {inv['repair_command']}")
        else:
            parts.append("  none")
        parts.append("")
        if stale_warnings:
            parts.append(f"## STALE/INFORMATIONAL WARNINGS ({len(stale_warnings)})\n")
            for inv, detail in stale_warnings:
                parts.append(f"  WARN [{inv['id']}]: {inv['description']}")
                if detail:
                    parts.append(f"        {detail}")
                if inv.get("repair_command"):
                    parts.append(f"        repair: {inv['repair_command']}")
            parts.append("")
    elif warnings:
        parts.append(f"## WARNINGS ({len(warnings)})\n")
        for inv, detail in warnings:
            parts.append(f"  WARN [{inv['id']}]: {inv['description']}")
            if detail:
                parts.append(f"        {detail}")
            if inv.get("repair_command"):
                parts.append(f"        repair: {inv['repair_command']}")
        parts.append("")

    if infos:
        parts.append(f"## INFO ({len(infos)})\n")
        for inv, detail in infos:
            parts.append(f"  INFO [{inv['id']}]: {inv['description']}")
            if detail:
                parts.append(f"        {detail}")
        parts.append("")

    # Enumerate PASSes only when verbose=True OR there are no failures.
    if passes and (verbose or not (errors or warnings or infos)):
        parts.append(f"## Verified ({len(passes)})\n")
        for inv, detail in passes:
            line = f"  PASS [{inv['id']}]: {inv['description']}"
            if detail:
                line += f" ({detail})"
            parts.append(line)
    elif passes:
        parts.append(f"## Verified ({len(passes)} -- detail suppressed; use `evolve(focus='invariants', query='verbose')` for full listing)")

    parts.append(f"\n## Extending")
    parts.append(f"Add entries to `tools/HME/config/invariants/*.json`; `invariants.json` is the index.")
    parts.append("Types: " + ", ".join(sorted({
        "files_executable", "files_referenced", "file_exists", "json_valid",
        "glob_count_gte", "pattern_in_file", "patterns_all_in_file",
        "pattern_count_gte", "symbols_used", "symbols_have_kb",
        "files_mtime_window", "kb_content_no_pattern", "kb_freshness",
        "metric_has_variance", "metric_threshold", "correlation_direction",
        "activity_events_balanced", "activity_field_sanity",
        "same_commit_determinism", "invariant_chronically_failing",
        "shell_output_empty", "eslint_concordance_complete",
    })))

    return "\n".join(parts)
