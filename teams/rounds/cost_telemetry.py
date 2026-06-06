"""D2: per-round cost telemetry + adaptive-effort ADVISORY (run via `python3` or
import; no shebang -- library + thin CLI).

COST-CONTROL CHARTER (binding, CEO directive): this module only OBSERVES cost and
ADVISES a minimum effort floor. It never caps effort, never shortens a leash,
never truncates a peer's depth, and never abridges multi-turn peer dialogue.
`advise_effort` returns a FLOOR (and generous headroom), explicitly NOT a ceiling.

- record(...) appends one JSONL row per round to teams/runtime/round-cost-telemetry.jsonl
  capturing target, arms, baseline/mesh reply bytes, findings, cost-per-finding,
  and optional wall-clock duration. Pure observability.
- advise_effort(source_bytes) suggests a minimum effort + leash-floor scaled to the
  target's size so a big/complex surface is never UNDER-resourced. It only raises
  floors; callers may always go higher.
- report(...) summarizes the telemetry (count, median cost-per-finding, etc.).
"""
from __future__ import annotations

import json
import statistics
import sys
import time
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_DEFAULT_TELEMETRY = _REPO / "teams" / "runtime" / "round-cost-telemetry.jsonl"

# Effort floors are a NON-binding minimum. A reviewer/round may always exceed them;
# nothing here may be used to cap or shorten. Sizes in bytes.
_EFFORT_LADDER = [
    (0, "medium", 240),
    (8_000, "high", 360),
    (20_000, "high", 480),
    (60_000, "max", 600),
]


def _cost_per_finding(bytes_total: int, findings: int) -> float:
    return round(bytes_total / findings, 1) if findings > 0 else 0.0


def record(scorecard: dict, target: str, duration_sec: float | None = None,
           telemetry_path: str | Path | None = None) -> dict:
    """Append one observability row for a scored round. Never caps anything."""
    base = scorecard.get("baseline", {}) if isinstance(scorecard, dict) else {}
    mesh = scorecard.get("mesh", {}) if isinstance(scorecard, dict) else {}
    row = {
        "ts": time.time(),
        "target": target,
        "arms": mesh.get("arms", 0),
        "baseline_bytes": base.get("reply_bytes", 0),
        "mesh_bytes": mesh.get("reply_bytes", 0),
        "baseline_findings": base.get("findings", 0),
        "mesh_findings": mesh.get("findings", 0),
        "unique_in_mesh": scorecard.get("unique_in_mesh", 0) if isinstance(scorecard, dict) else 0,
        "mesh_cost_per_finding": _cost_per_finding(mesh.get("reply_bytes", 0), mesh.get("findings", 0)),
        "duration_sec": round(duration_sec, 1) if isinstance(duration_sec, (int, float)) else None,
        "note": "observability only; never used to cap effort/depth/dialogue",
    }
    path = Path(telemetry_path) if telemetry_path else _DEFAULT_TELEMETRY
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, sort_keys=True) + "\n")
    except OSError:
        pass  # silent-ok: telemetry is best-effort observability, never load-bearing
    return row


def advise_effort(source_bytes: int) -> dict:
    """Return a MINIMUM effort + leash floor scaled to target size. This is a
    floor with headroom, NOT a cap -- a reviewer may always spend more."""
    effort, leash_floor = "medium", 240
    for threshold, eff, leash in _EFFORT_LADDER:
        if source_bytes >= threshold:
            effort, leash_floor = eff, leash
    return {
        "min_effort": effort,
        "leash_floor_sec": leash_floor,
        "is_floor_not_cap": True,
        "headroom": "callers may exceed both freely; never cap depth or peer dialogue",
    }


def report(telemetry_path: str | Path | None = None) -> dict:
    path = Path(telemetry_path) if telemetry_path else _DEFAULT_TELEMETRY
    rows = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    except OSError:
        return {"rounds": 0}
    cpf = [r.get("mesh_cost_per_finding", 0) for r in rows if r.get("mesh_cost_per_finding")]
    durs = [r.get("duration_sec") for r in rows if isinstance(r.get("duration_sec"), (int, float))]
    return {
        "rounds": len(rows),
        "median_mesh_cost_per_finding": round(statistics.median(cpf), 1) if cpf else 0.0,
        "median_duration_sec": round(statistics.median(durs), 1) if durs else None,
        "total_unique_in_mesh": sum(r.get("unique_in_mesh", 0) for r in rows),
        "targets": sorted({r.get("target", "") for r in rows if r.get("target")}),
    }


def main(argv: list) -> int:
    if argv[:1] == ["--advise"]:
        try:
            size = int(argv[1])
        except (IndexError, ValueError):
            sys.stderr.write("usage: cost_telemetry.py --advise <source_bytes>\n")
            return 2
        print(json.dumps(advise_effort(size), indent=2, sort_keys=True))
        return 0
    print(json.dumps(report(), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
