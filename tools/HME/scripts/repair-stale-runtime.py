#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path

ROOT = Path(os.environ.get("PROJECT_ROOT", Path(__file__).resolve().parents[3]))
LOCK_NAME = "run" + ".lock"


def _pid_alive(pid: int) -> bool | None:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return None


def _read_pid(path: Path) -> int | None:
    try:
        raw = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None
    m = re.search(r"\d+", raw)
    return int(m.group(0)) if m else None


def _event(root: Path, payload: dict) -> None:
    out = root / "tools" / "HME" / "runtime" / "stale-runtime-repairs.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, sort_keys=True) + "
")


def inspect(root: Path, fix: bool = False) -> dict:
    path = root / "tmp" / LOCK_NAME
    if not path.exists():
        return {"ok": True, "status": "absent"}
    pid = _read_pid(path)
    age_s = max(0.0, time.time() - path.stat().st_mtime)
    if pid is None:
        return {"ok": False, "status": "unparseable", "age_s": age_s}
    alive = _pid_alive(pid)
    base = {"pid": pid, "alive": alive, "age_s": age_s}
    if alive is not False:
        return {"ok": True, "status": "alive", **base}
    if not fix:
        return {"ok": False, "status": "stale", **base}
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    dest = path.with_name(f"{path.name}.stale-{stamp}")
    try:
        path.replace(dest)
    except FileNotFoundError:
        return {"ok": True, "status": "absent-raced", **base}
    payload = {"ts": time.time(), "status": "repaired", "archived": str(dest)}
    payload.update(base)
    _event(root, payload)
    return {"ok": True, "status": "repaired", "archived": str(dest), **base}


def main() -> int:
    ap = argparse.ArgumentParser(description="Repair stale runtime sentinels")
    ap.add_argument("--root", default=str(ROOT))
    ap.add_argument("--fix", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    result = inspect(Path(args.root).resolve(), fix=args.fix)
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        status = result.get("status")
        if status == "repaired":
            print(f"stale-runtime: REPAIRED dead pid={result.get('pid')}")
        elif status == "stale":
            print(f"stale-runtime: STALE dead pid={result.get('pid')}")
        else:
            print(f"stale-runtime: {str(status).upper()}")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
