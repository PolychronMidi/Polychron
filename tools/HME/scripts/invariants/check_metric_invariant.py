#!/usr/bin/env python3
"""Named metric/runtime invariant checks used by invariants config."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[4])


def _json(rel: str, default=None):
    path = ROOT / rel
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"{rel}: unreadable JSON: {type(exc).__name__}: {exc}")
        return default


def _jsonl(rel: str) -> list[dict]:
    path = ROOT / rel
    if not path.is_file():
        return []
    out: list[dict] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def predictions_log_gap_bounded() -> None:
    rounds = (_json("output/metrics/hme-prediction-accuracy.json", {}) or {}).get("rounds") or []
    if len(rounds) < 2:
        print("insufficient history")
        return
    def gap(row): return (row.get("predictions_log_size") or 0) - (row.get("predictions_total") or 0)
    prev, cur = gap(rounds[-2]), gap(rounds[-1])
    if cur - prev > 20:
        print(f"gap rose: {prev}->{cur} (threshold: +20)")


def retirement_log_consistent() -> None:
    retired = {
        row.get("id") for row in _jsonl("output/metrics/legacy-override-retirement-log.jsonl")
        if row.get("action") != "keep" and row.get("id")
    }
    src = (ROOT / "scripts/pipeline/validators/check-hypermeta-jurisdiction.js").read_text(encoding="utf-8", errors="replace")
    current = set(re.findall(r"id:\s*'([\w.-]+)'", src))
    for item in sorted(retired & current):
        print(f"retired id still allowlisted: {item}")


def legacy_override_chronically_zero() -> None:
    rows = _jsonl("output/metrics/legacy-override-history.jsonl")[-5:]
    retired = {
        row.get("id") for row in _jsonl("output/metrics/legacy-override-retirement-log.jsonl")
        if row.get("action") != "keep" and row.get("id")
    }
    ids: set[str] = set()
    for row in rows:
        ids.update((row.get("fires") or {}).keys())
        ids.update((row.get("entries") or {}).keys())
    ids -= retired
    if len(rows) < 5:
        return
    for item in sorted(ids):
        if all((row.get("fires") or {}).get(item, 0) == 0 and (row.get("entries") or {}).get(item, 0) == 0 for row in rows):
            print(f"legacy override unused 5+ rounds -- RETIRE: {item}")


def hypermeta_legacy_overrides_covered() -> None:
    data = _json("output/metrics/hypermeta-jurisdiction.json", {}) or {}
    reg = data.get("registeredByLegacyId") or {}
    for legacy in data.get("legacyOverrides") or []:
        item = legacy.get("id")
        if item and reg.get(item, 0) == 0:
            print(f"legacy id has zero matches: {item}")


def envelope_shift_bounded() -> None:
    data = _json("output/metrics/hme-envelope-shift.json", {}) or {}
    shift = data.get("average_relative_shift")
    top = (data.get("top_shifted_fields") or [{}])[0].get("field", "?")
    if isinstance(shift, (int, float)) and shift > 0.5:
        print(f"envelope shift {shift} > 0.5 (regime change), top field: {top}")


def cross_arc_hidden_drift_detector() -> None:
    consensus = _json("output/metrics/hme-consensus.json", {}) or {}
    drift = _json("output/metrics/hme-legendary-drift.json", {}) or {}
    if consensus.get("divergence") == "low" and drift.get("status") == "drift_detected":
        print(
            f"hidden drift: consensus-low divergence BUT drift detected (score {drift.get('drift_score')}). "
            "Substrates all report healthy while state has departed envelope."
        )


def legendary_drift_bounded() -> None:
    data = _json("output/metrics/hme-legendary-drift.json", {}) or {}
    if data.get("status") == "drift_detected":
        outs = ",".join(o.get("field", "") for o in (data.get("outliers") or [])[:3])
        print(f"drift={data.get('drift_score')} > {data.get('drift_threshold')} top_outliers=[{outs}]")


def patterns_have_action_on_match() -> None:
    data = _json("output/metrics/hme-pattern-matches.json", {}) or {}
    for match in data.get("matches") or []:
        if not match.get("action_summary") or not match.get("action_steps"):
            print(f"pattern matched without action: {match.get('id')}")


def invariant_efficacy_not_flappy_excessive() -> None:
    data = _json("output/metrics/hme-invariant-efficacy.json", {}) or {}
    flappy = (data.get("class_counts") or {}).get("flappy", 0)
    if flappy > 3:
        print(f"flappy count {flappy} > 3 (threshold); candidates: {data.get('retirement_candidates', [])}")


def consensus_not_divergent() -> None:
    data = _json("output/metrics/hme-consensus.json", {}) or {}
    rows = _jsonl("output/metrics/hme-arc-timeseries.jsonl")
    tail = rows[-2:] if len(rows) >= 2 else []
    cur_outs = sorted(o.get("voter", "") for o in data.get("outliers", []))
    persistent = len(tail) == 2 and len(cur_outs) > 0 and all(
        sorted((row.get("arc_i") or {}).get("outlier_voters") or []) == cur_outs for row in tail
    )
    if data.get("divergence") == "high" and not persistent:
        print(f"consensus divergent (new): stdev={data.get('stdev')} mean={data.get('mean')} outliers=[{','.join(cur_outs)}]")


def no_duplicate_output_dirs() -> None:
    skip_parts = {"node_modules", ".git", ".venv"}
    for path in ROOT.rglob("*"):
        if not path.is_dir() or skip_parts & set(path.relative_to(ROOT).parts):
            continue
        rel = path.relative_to(ROOT).as_posix()
        if path.name in {"log", "tmp"} and rel not in {"log", "tmp"}:
            print(f"./{rel}")
        if path.name == "metrics" and rel != "output/metrics":
            print(f"./{rel}")


def antagonism_registry_schema_valid() -> None:
    data = _json("output/metrics/hme-suspected-upstreams.json", {}) or {}
    missing = [k for k in ("candidates", "confirmed", "refuted") if k not in data]
    if missing:
        print(f"missing registry bucket(s): {', '.join(missing)}")


def versions_file_exists() -> None:
    data = _json("tools/HME/config/versions.json", {}) or {}
    missing = [k for k in ("cli", "proxy", "worker") if k not in data]
    if missing:
        print(f"missing version key(s): {', '.join(missing)}")


def review_verdict_emitter_importable() -> None:
    sys.path.insert(0, str(ROOT / "tools/HME/service"))
    try:
        from server.onboarding_chain import emit_review_verdict_marker
        marker = emit_review_verdict_marker("clean")
        assert "HME_REVIEW_VERDICT" in marker and "clean" in marker, f"bad marker: {marker!r}"
    except Exception as exc:
        print(f"review verdict marker import failed: {type(exc).__name__}: {exc}")


def lance_deletions_not_excessive() -> None:
    path = ROOT / "tools/HME/KB/code_chunks.lance/_deletions"
    n = len([p for p in path.iterdir() if p.is_file()]) if path.is_dir() else 0
    if n > 50:
        print(f"_deletions has {n} files (cap=50)")


RULES = {
    name.replace("_", "-"): fn
    for name, fn in list(globals().items())
    if callable(fn) and getattr(fn, "__module__", None) == __name__ and not name.startswith("_")
}


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in RULES:
        print("usage: check_metric_invariant.py <rule>", file=sys.stderr)
        print("rules: " + ", ".join(sorted(RULES)), file=sys.stderr)
        return 2
    RULES[sys.argv[1]]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
