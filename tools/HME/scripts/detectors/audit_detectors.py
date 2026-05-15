#!/usr/bin/env python3
"""Meta-detector: audit the detector suite against its own emitted history.

The detectors observe agent behavior and emit verdicts. Nothing observes the
detectors. This script closes the loop -- Rung 4 of the hypermeta ladder.

Two modes:

(1) DRIFT MODE (default): reads `output/metrics/detector-stats.jsonl` and
    reports per-detector fire-rate, rescue-rate, drift, and notable signals.

(2) CORPUS MODE (--corpus): runs each detector against an in-memory corpus
    of LABELED probes -- known-positive (should fire) and known-negative
    (should not fire). Reports false-positive and false-negative counts.
    The corpus is the regression contract for the detectors themselves;
    silent recognizer drift surfaces here as a verdict mismatch.

Probes overlap with test_detector_chain.py and test_deny_alternatives.py
INTENTIONALLY -- those tests assert behavior on individual fixtures; this
script aggregates, classifies, and computes accuracy metrics across all
fixtures so you can see "scope_escape's recall fell from 100% to 87%
since I added the b-clause rescue" without manually diffing test output.

Output: human-readable summary. No --strict -- this is a diagnostic.

Usage:
    python3 tools/HME/scripts/detectors/audit_detectors.py
    python3 tools/HME/scripts/detectors/audit_detectors.py --corpus
    python3 tools/HME/scripts/detectors/audit_detectors.py --json
    python3 tools/HME/scripts/detectors/audit_detectors.py --window 200
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_PROJECT = _HERE.parent.parent.parent.parent
_STATS_FILE = (
    Path(os.environ.get("PROJECT_ROOT") or _PROJECT)
    / "output" / "metrics" / "detector-stats.jsonl"
)


def _load_events(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def _classify(detector: str, verdict: str, detail: str) -> str:
    """Bucket a verdict into one of: 'fire', 'ok-rescue', 'ok-clean'.

    'ok-rescue': verdict was ok AND the detail mentions a rescue/exemption
    path firing. 'ok-clean': verdict ok with no rescue path mentioned.
    Drives the rescue-rate metric downstream.
    """
    if verdict != "ok":
        return "fire"
    d = (detail or "").lower()
    rescue_tokens = (
        "rescue", "exemption", "exempt", "fixed it", "narrow_scope",
        "research_exemption", "rescue_b_clause", "rescue_backward",
        "self_resolve", "solo_rationale", "b_clause",
    )
    if any(tok in d for tok in rescue_tokens):
        return "ok-rescue"
    return "ok-clean"


def _summarize(events: list[dict], window: int) -> dict:
    by_detector: dict[str, list[dict]] = defaultdict(list)
    for ev in events:
        det = ev.get("detector")
        if not det:
            continue
        by_detector[det].append(ev)

    out = {}
    for det, evs in sorted(by_detector.items()):
        n_total = len(evs)
        recent = evs[-window:] if len(evs) > window else evs
        n_recent = len(recent)

        def _bucket(rows):
            b = defaultdict(int)
            for ev in rows:
                b[_classify(det, ev.get("verdict", ""),
                            ev.get("detail", ""))] += 1
            return dict(b)

        all_b = _bucket(evs)
        rec_b = _bucket(recent)

        def _rate(buckets, key):
            tot = sum(buckets.values())
            return (buckets.get(key, 0) / tot) if tot else 0.0

        all_fire = _rate(all_b, "fire")
        rec_fire = _rate(rec_b, "fire")
        all_rescue = _rate(all_b, "ok-rescue")
        rec_rescue = _rate(rec_b, "ok-rescue")

        # Drift = recent-window fire rate minus all-time fire rate. Positive
        drift = rec_fire - all_fire
        out[det] = {
            "total_events": n_total,
            "recent_events": n_recent,
            "fire_rate_all": round(all_fire, 4),
            "fire_rate_recent": round(rec_fire, 4),
            "fire_rate_drift": round(drift, 4),
            "rescue_rate_all": round(all_rescue, 4),
            "rescue_rate_recent": round(rec_rescue, 4),
            "buckets_all": all_b,
            "buckets_recent": rec_b,
        }
    return out


# Probe corpus lives in _audit_corpus_probes.py (data-only). Splitting it
sys.path.insert(0, str(_HERE))
from _audit_corpus_probes import CORPUS as _CORPUS  # noqa: E402


def _run_corpus_probe(detector: str, user_msg: str, assistant_text: str,
                      env_overrides: dict | None = None) -> str:
    """Build a synthetic transcript for one corpus probe and run the
    detector against it. Returns the verdict ('ok', 'fire-name', etc.).

    Probes are routed through $PROJECT_ROOT/tmp/ rather than /tmp/
    because fabrication_check.py applies a path-containment guard
    (only scans transcripts under ~/.claude/projects/ or PROJECT_ROOT/tmp/)
    to prevent attacker-influenced paths from leaking secret excerpts
    into detector-stats.jsonl. /tmp/ wouldn't pass; the guard would
    silent-no-op every probe and report misleading 'ok' verdicts.

    env_overrides lets a probe inject env vars (e.g. ADVISOR_DOCTRINE_TIER)
    that gate the detector. They're applied before main() and restored in
    the finally so probes don't leak into each other."""
    import importlib
    import json as _json
    import tempfile
    import uuid

    sys.path.insert(0, str(_HERE))
    # fabrication_check (and any future detector with the same hardening)
    if not os.environ.get("PROJECT_ROOT"):
        os.environ["PROJECT_ROOT"] = str(_PROJECT)
    mod = importlib.import_module(detector)
    events = [
        {"type": "user", "message": {"role": "user", "content": user_msg}},
        {"type": "assistant", "message": {"role": "assistant",
                                          "content": [{"type": "text",
                                                       "text": assistant_text}]}},
    ]
    project_tmp = (Path(os.environ.get("PROJECT_ROOT") or _PROJECT) / "tmp")
    project_tmp.mkdir(parents=True, exist_ok=True)
    fname = f"audit-detector-probe-{uuid.uuid4().hex[:12]}.jsonl"
    path = str(project_tmp / fname)
    with open(path, "w", encoding="utf-8") as f:
        for ev in events:
            f.write(_json.dumps(ev) + "\n")
    old_argv = sys.argv
    saved_env: dict[str, str | None] = {}
    if env_overrides:
        for k, v in env_overrides.items():
            saved_env[k] = os.environ.get(k)
            os.environ[k] = v
    try:
        sys.argv = [old_argv[0] if old_argv else "test", path]
        from io import StringIO
        old_stdout = sys.stdout
        sys.stdout = StringIO()
        try:
            mod.main()
        except SystemExit:
            pass  # silent-ok: diagnostic; failure non-fatal
        verdict = sys.stdout.getvalue().strip()
        sys.stdout = old_stdout
        return verdict
    finally:
        sys.argv = old_argv
        for k, prev in saved_env.items():
            if prev is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = prev
        try:
            os.unlink(path)
        except OSError:
            pass  # silent-ok: best-effort fs op


def _run_corpus() -> dict:
    """Walk the corpus, compute per-detector confusion metrics."""
    by_detector: dict[str, dict] = defaultdict(lambda: {
        "tp": 0, "fp": 0, "tn": 0, "fn": 0, "mismatches": []
    })
    for entry in _CORPUS:
        det, label, expected, user_msg, asst, *rest = entry
        env_overrides = rest[0] if rest else None
        actual = _run_corpus_probe(det, user_msg, asst, env_overrides)
        b = by_detector[det]
        is_positive = (expected != "ok")
        actually_fired = (actual != "ok")
        if is_positive and actually_fired:
            b["tp"] += 1
        elif is_positive and not actually_fired:
            b["fn"] += 1
            b["mismatches"].append({
                "label": label, "expected": expected, "actual": actual,
                "kind": "false-negative",
            })
        elif not is_positive and actually_fired:
            b["fp"] += 1
            b["mismatches"].append({
                "label": label, "expected": expected, "actual": actual,
                "kind": "false-positive",
            })
        else:
            b["tn"] += 1
    return dict(by_detector)


def main(argv: list) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--json", action="store_true")
    p.add_argument("--corpus", action="store_true",
                   help="run the labeled corpus and report confusion metrics "
                        "instead of historical drift")
    p.add_argument("--window", type=int, default=100,
                   help="recent-window size for drift comparison")
    args = p.parse_args(argv)

    if args.corpus:
        results = _run_corpus()
        if args.json:
            print(json.dumps({
                "corpus_size": len(_CORPUS),
                "by_detector": results,
            }, indent=2))
            return 0
        print(f"audit_detectors --corpus: {len(_CORPUS)} probes")
        print()
        for det, b in sorted(results.items()):
            n = b["tp"] + b["fp"] + b["tn"] + b["fn"]
            recall = b["tp"] / (b["tp"] + b["fn"]) if (b["tp"] + b["fn"]) else None
            prec = b["tp"] / (b["tp"] + b["fp"]) if (b["tp"] + b["fp"]) else None
            print(f"  {det}")
            print(f"    n={n}  TP={b['tp']}  FP={b['fp']}  TN={b['tn']}  FN={b['fn']}")
            if recall is not None:
                print(f"    recall={recall:.2%}", end="")
            if prec is not None:
                print(f"  precision={prec:.2%}", end="")
            print()
            for m in b["mismatches"]:
                print(f"    [{m['kind']}] {m['label']}: "
                      f"expected={m['expected']!r}, got={m['actual']!r}")
        return 0

    events = _load_events(_STATS_FILE)
    if not events:
        print(f"audit_detectors: no data in {_STATS_FILE}")
        return 0

    summary = _summarize(events, args.window)
    if args.json:
        print(json.dumps({
            "stats_file": str(_STATS_FILE),
            "total_events": len(events),
            "window": args.window,
            "by_detector": summary,
        }, indent=2))
        return 0

    print(f"audit_detectors: {len(events)} events across {len(summary)} detector(s)")
    print(f"  drift window: last {args.window} events vs all-time")
    print()
    print(f"  {'detector':<28} {'recent':>10} {'all-time':>10} {'drift':>10} "
          f"{'rescue-rec':>11} {'rescue-all':>11}  buckets-recent")
    for det, s in sorted(summary.items()):
        drift_marker = ""
        if abs(s["fire_rate_drift"]) >= 0.10:
            drift_marker = "  <- shifted >=10%"
        print(f"  {det:<28} {s['fire_rate_recent']:>10.2%} "
              f"{s['fire_rate_all']:>10.2%} {s['fire_rate_drift']:>+10.2%} "
              f"{s['rescue_rate_recent']:>11.2%} {s['rescue_rate_all']:>11.2%}  "
              f"{dict(s['buckets_recent'])}"
              f"{drift_marker}")

    # Surface notable findings.
    notable = []
    for det, s in summary.items():
        if abs(s["fire_rate_drift"]) >= 0.10:
            notable.append(f"{det}: fire-rate drift "
                           f"{s['fire_rate_drift']:+.2%} (recent {s['fire_rate_recent']:.2%} "
                           f"vs all-time {s['fire_rate_all']:.2%})")
        if s["rescue_rate_recent"] == 0 and s["recent_events"] >= 20:
            notable.append(f"{det}: 0% rescue rate over last "
                           f"{s['recent_events']} events -- rescue regexes "
                           f"may be dead code")
        if s["fire_rate_recent"] == 0 and s["recent_events"] >= 30:
            notable.append(f"{det}: 0% fire rate over last "
                           f"{s['recent_events']} events -- detector silent; "
                           f"either codebase clean or recognizer broken")
    if notable:
        print()
        print("Notable signals:")
        for n in notable:
            print(f"  - {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
