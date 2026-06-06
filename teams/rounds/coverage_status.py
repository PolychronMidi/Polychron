"""F1 (auditability layer): machine-readable myth0s coverage status (run via
`python3` or import; no shebang -- library + thin CLI).

Turns doc/myth0s-coverage-map.md into a governable/auditable signal: which
load-bearing surfaces (policy-enforcement / state-mutation / context-consumption)
have been mesh-reviewed vs are still pending. The governance/audit layer (CI, a
coherence verifier, or a human) can consult this so review coverage of the
control plane is tracked, not assumed.

This is the AUDITABLE half of F1. The deeper ENFORCEMENT half -- making permission
decisions / write gates / lifecycle hooks actually CONSULT review status to gate
autonomous actions -- is a control-plane change that needs an explicit design
decision (see TODO #15, status 3_); it is intentionally NOT done here.

Usage:
  coverage_status.py [--json] [--strict]
    --json    machine-readable status
    --strict  exit 1 if any load-bearing surface is still pending
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_MAP = _REPO / "doc" / "myth0s-coverage-map.md"
_ROW_RE = re.compile(r"^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$")
_SECTION_RE = re.compile(r"^##\s+(.*)$")


def parse_map(map_path: str | Path = _MAP) -> list[dict]:
    rows: list[dict] = []
    section = ""
    try:
        lines = Path(map_path).read_text(encoding="utf-8").splitlines()
    except OSError:
        return rows
    for line in lines:
        sm = _SECTION_RE.match(line.strip())
        if sm:
            section = sm.group(1).split("(")[0].strip()
            continue
        m = _ROW_RE.match(line.strip())
        if not m:
            continue
        name, file, status = (g.strip() for g in m.groups())
        if name.lower() in ("surface", "---") or file.lower() in ("file", "---"):
            continue
        # status cell may carry a parenthetical, e.g. "reviewed (clean audit)".
        st = status.split("(")[0].strip().lower()
        rows.append({"section": section, "surface": name, "file": file, "status": st})
    return rows


def status_report(map_path: str | Path = _MAP) -> dict:
    rows = parse_map(map_path)
    total = len(rows)
    reviewed = [r for r in rows if r["status"] == "reviewed"]
    pending = [r for r in rows if r["status"] == "pending"]
    other = [r for r in rows if r["status"] not in ("reviewed", "pending")]
    return {
        "total": total,
        "reviewed": len(reviewed),
        "pending": len(pending),
        "other": len(other),
        "coverage_pct": round(100.0 * len(reviewed) / total, 1) if total else 0.0,
        "pending_surfaces": [{"surface": r["surface"], "file": r["file"], "section": r["section"]} for r in pending],
    }


def main(argv: list) -> int:
    rep = status_report()
    if "--json" in argv:
        print(json.dumps(rep, indent=2, sort_keys=True))
    else:
        print(f"myth0s coverage: {rep['reviewed']}/{rep['total']} reviewed ({rep['coverage_pct']}%), {rep['pending']} pending")
        for p in rep["pending_surfaces"]:
            print(f"  pending: {p['surface']} ({p['file']})")
    if "--strict" in argv and rep["pending"] > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
