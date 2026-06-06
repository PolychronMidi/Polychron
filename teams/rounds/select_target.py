"""D1: smarter target selection (run via `python3 teams/rounds/select_target.py`
or import; intentionally no shebang -- library + thin CLI).

Read doc/myth0s-coverage-map.md and return the next `pending` load-bearing
surface so the mesh focuses on what has not been reviewed yet, instead of
re-reviewing already-covered code.

Cost-control charter (binding): selection only FOCUSES effort onto unreviewed
surfaces. It never caps a peer's depth, never limits how long a review may run,
and never abridges inter-agent dialogue.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

_ROW_RE = re.compile(r"^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([A-Za-z]+)\s*\|$")


def pending_targets(map_path: str | Path) -> list[dict]:
    rows: list[dict] = []
    try:
        lines = Path(map_path).read_text(encoding="utf-8").splitlines()
    except OSError:
        return rows
    for line in lines:
        m = _ROW_RE.match(line.strip())
        if not m:
            continue
        name, file, status = m.group(1).strip(), m.group(2).strip(), m.group(3).strip().lower()
        if name.lower() in ("surface", "---") or file.lower() in ("file", "---"):
            continue
        if status == "pending":
            rows.append({"name": name, "file": file})
    return rows


def next_target(map_path: str | Path) -> dict | None:
    rows = pending_targets(map_path)
    return rows[0] if rows else None


def _default_map() -> Path:
    return Path(__file__).resolve().parents[2] / "doc" / "myth0s-coverage-map.md"


def main(argv: list) -> int:
    map_path = Path(argv[0]) if argv else _default_map()
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
