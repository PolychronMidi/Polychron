"""Entry point — `python3 -m verify_coherence [--json|--score|--threshold=N]`.

Runs REGISTRY end-to-end, aggregates weighted scores per category and
overall, persists a per-verifier snapshot (hci-verifier-snapshot.json)
for diff-across-runs, and prints in text / JSON / score-only modes.

Exit codes:
  0 — HCI >= threshold (default 80)
  1 — HCI < threshold
  2 — engine error (internal failure, not a coherence failure)
"""
from __future__ import annotations

import json
import os
import sys
import time

from ._base import METRICS_DIR, _PROJECT, FAIL, ERROR
from . import REGISTRY


def run_engine() -> dict:
    results: dict = {}
    by_category: dict = {}
    for v in REGISTRY:
        result = v.execute()
        results[v.name] = {
            "category": v.category,
            "subtag": getattr(v, "subtag", "") or "",
            "weight": v.weight,
            **result.to_dict(),
        }
        by_category.setdefault(v.category, []).append((v, result))

    # Aggregate weighted score per category, then overall.
    category_scores = {}
    for cat, entries in by_category.items():
        total_w = sum(v.weight for v, _r in entries)
        weighted = sum(v.weight * r.score for v, r in entries)
        category_scores[cat] = {
            "score": (weighted / total_w) if total_w > 0 else 0.0,
            "verifier_count": len(entries),
            "weight_total": total_w,
        }

    total_w = sum(v.weight for v in REGISTRY)
    weighted = sum(v.weight * results[v.name]["score"] for v in REGISTRY)
    hci = (weighted / total_w * 100.0) if total_w > 0 else 0.0

    return {
        "hci": round(hci, 1),
        "verifier_count": len(REGISTRY),
        "categories": category_scores,
        "verifiers": results,
        "timestamp": time.time(),
        "project_root": _PROJECT,
    }


def format_text(report: dict) -> str:
    lines = []
    hci = report["hci"]
    bar = "█" * int(hci / 5) + "░" * (20 - int(hci / 5))
    lines.append("# HME Coherence Index")
    lines.append("")
    lines.append(f"  HCI: {hci:5.1f} / 100  [{bar}]")
    lines.append(f"  {report['verifier_count']} verifiers across "
                 f"{len(report['categories'])} categories")
    lines.append("")
    lines.append("## Categories")
    for cat in sorted(report["categories"].keys()):
        info = report["categories"][cat]
        score_pct = info["score"] * 100
        suf = "s" if info["verifier_count"] != 1 else ""
        lines.append(f"  {cat:12} {score_pct:5.1f}%   "
                     f"({info['verifier_count']} verifier{suf})")
    lines.append("")
    lines.append("## Verifiers (status / score / summary)")
    by_cat: dict = {}
    for name, info in report["verifiers"].items():
        by_cat.setdefault(info["category"], []).append((name, info))
    for cat in sorted(by_cat.keys()):
        lines.append("")
        lines.append(f"### {cat}")
        for name, info in sorted(by_cat[cat]):
            score_pct = info["score"] * 100
            subtag = info.get("subtag", "")
            tag_col = f"[{subtag}]" if subtag else ""
            lines.append(
                f"  {info['status']:5}  {score_pct:5.1f}%  {name:30}  {tag_col:24}  {info['summary']}"
            )
            if info["status"] in (FAIL, ERROR) and info["details"]:
                for d in info["details"][:5]:
                    lines.append(f"           {d}")
    lines.append("")
    return "\n".join(lines)


def _persist_snapshot(report: dict) -> None:
    """Persist per-verifier snapshot for consecutive-round diffs. Answers
    'which of the N verifiers flipped between HCI=94 and HCI=96' in one
    read of the JSON file. Last snapshot is moved to .prev so a 2-run
    diff is always available without keeping a full history."""
    try:
        snapshot = {
            "ts": int(time.time()),
            "hci": report.get("hci"),
            "verifiers": {
                name: {"status": info.get("status"), "score": info.get("score")}
                for name, info in (report.get("verifiers") or {}).items()
            },
        }
        snap_path = os.path.join(METRICS_DIR, "hci-verifier-snapshot.json")
        if os.path.isfile(snap_path):
            try:
                os.replace(snap_path, snap_path + ".prev")
            except OSError:  # silent-ok: snapshot .prev rotation may fail on permission; not load-bearing
                pass
        with open(snap_path, "w", encoding="utf-8") as _f:
            json.dump(snapshot, _f, indent=2)
    except Exception as _snap_err:
        sys.stderr.write(f"snapshot persist failed: {_snap_err}\n")


def main(argv: list) -> int:
    threshold = 80.0
    output_mode = "text"
    for arg in argv:
        if arg == "--json":
            output_mode = "json"
        elif arg == "--score":
            output_mode = "score"
        elif arg.startswith("--threshold="):
            try:
                threshold = float(arg.split("=", 1)[1])
            except ValueError:
                pass

    try:
        report = run_engine()
    except Exception as e:
        import traceback
        sys.stderr.write(f"engine error: {e}\n{traceback.format_exc()}")
        return 2

    _persist_snapshot(report)

    if output_mode == "json":
        print(json.dumps(report, indent=2))
    elif output_mode == "score":
        print(int(round(report["hci"])))
    else:
        print(format_text(report))

    return 0 if report["hci"] >= threshold else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
