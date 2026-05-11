"""Buddy registry aggregator -- single read-side view of all buddy SID locations.

Reads (does not mutate) the dispersed SID stores:
  - runtime/hme/buddy-primary.sid + .floor + .effort_floor (handoff primary)
  - runtime/hme/buddy.sid + .floor (legacy single-buddy alias)
  - tmp/hme-buddy-N.sid + .floor (multi-buddy slots)
  - tmp/hme-buddy-seniors/<sid>.json (retired pool)

Writes the unified view to runtime/hme/buddy-registry.json.
Existing files remain authoritative writers (back-compat); registry is
a single-source-of-truth READ surface for consumers like i/handoff status.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "service"))
from repo_root import resolve as _resolve_root  # noqa: E402

_ROOT = Path(_resolve_root())
_RT = _ROOT / "runtime" / "hme"
_TMP = _ROOT / "tmp"


def _read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def build() -> dict:
    primary = {}
    sid = _read_text(_RT / "buddy-primary.sid")
    if sid:
        primary = {
            "sid": sid,
            "floor": _read_text(_RT / "buddy-primary.floor") or "E2",
            "effort_floor": _read_text(_RT / "buddy-primary.effort_floor") or "low",
        }

    legacy = {}
    sid = _read_text(_RT / "buddy.sid")
    if sid:
        legacy = {"sid": sid, "floor": _read_text(_RT / "buddy.floor") or "E2"}

    slots = []
    for p in sorted(_TMP.glob("hme-buddy-*.sid")):
        s = _read_text(p)
        if not s:
            continue
        slots.append({
            "slot": p.stem.split("-")[-1],
            "sid": s,
            "floor": _read_text(p.with_suffix(".floor")) or "E2",
        })

    seniors = []
    sd = _TMP / "hme-buddy-seniors"
    if sd.is_dir():
        for p in sorted(sd.glob("*.json")):
            try:
                with p.open(encoding="utf-8") as f:
                    seniors.append(json.load(f))
            except (OSError, json.JSONDecodeError):
                continue

    return {"primary": primary, "legacy_alias": legacy, "slots": slots, "seniors": seniors}


def write() -> Path:
    out = _RT / "buddy-registry.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(build(), indent=2) + "\n", encoding="utf-8")
    return out


if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
