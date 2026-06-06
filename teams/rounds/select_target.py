"""D1: smarter target selection (run via `python3 teams/rounds/select_target.py`
or import; intentionally no shebang -- library + thin CLI).

Read teams/rounds/coverage-map.json (machine-readable review-status DATA, not a
doc) and return the next `pending` load-bearing surface so the mesh focuses on
what has not been reviewed yet, instead of re-reviewing already-covered code.

Cost-control charter (binding): selection only FOCUSES effort onto unreviewed
surfaces. It never caps a peer's depth, never limits how long a review may run,
and never abridges inter-agent dialogue.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def _rows(map_path: str | Path) -> list[dict]:
    try:
        data = json.loads(Path(map_path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    out: list[dict] = []
    for section in data.get("sections", []):
        sect = str(section.get("section", "")).strip()
        for s in section.get("surfaces", []):
            out.append({
                "section": sect,
                "name": str(s.get("surface", "")).strip(),
                "file": str(s.get("file", "")).strip(),
                "status": str(s.get("status", "")).strip().lower(),
            })
    return out


def pending_targets(map_path: str | Path) -> list[dict]:
    return [{"name": r["name"], "file": r["file"]} for r in _rows(map_path) if r["status"] == "pending"]


def next_target(map_path: str | Path) -> dict | None:
    rows = pending_targets(map_path)
    return rows[0] if rows else None


def _default_map() -> Path:
    return Path(__file__).resolve().parent / "coverage-map.json"


def main(argv: list) -> int:
    # The map path is the first NON-flag arg; flags like --all must not be
    # mistaken for a path (self-found bug when dogfooding the CLI).
    positional = [a for a in argv if not a.startswith("--")]
    map_path = Path(positional[0]) if positional else _default_map()
    if "--all" in argv:
        for t in pending_targets(map_path):
            print(f"{t['name']}\t{t['file']}")
        return 0
    t = next_target(map_path)
    if not t:
        print("none")
        return 0
    print(f"{t['name']}\t{t['file']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main([a for a in sys.argv[1:]]))
