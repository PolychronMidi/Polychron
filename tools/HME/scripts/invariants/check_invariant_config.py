#!/usr/bin/env python3
"""Validate split invariant config and merged ID/type integrity."""
from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter
from pathlib import Path

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[4])
CONFIG = ROOT / "tools/HME/config/invariants.json"
DISPATCH = ROOT / "tools/HME/service/server/tools_analysis/evolution/evolution_invariants/dispatch.py"


def _load_doc(path: Path, seen: set[Path] | None = None) -> dict:
    seen = seen or set()
    path = path.resolve()
    if path in seen:
        raise ValueError(f"cyclic include: {path}")
    seen.add(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    merged = {k: v for k, v in data.items() if k not in {"_include", "invariants"}}
    invs = list(data.get("invariants") or [])
    for rel in data.get("_include") or []:
        child = _load_doc((path.parent / rel).resolve(), seen)
        invs.extend(child.get("invariants") or [])
    merged["invariants"] = invs
    return merged


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(CONFIG))
    parser.add_argument("--dispatch", default=str(DISPATCH))
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    config = Path(args.config)
    dispatch = Path(args.dispatch)
    try:
        data = _load_doc(config)
    except Exception as exc:
        print(f"invariant config load failed: {type(exc).__name__}: {exc}")
        return 0
    invs = data.get("invariants") or []
    for inv_id, n in sorted(Counter(i.get("id") for i in invs).items()):
        if not inv_id:
            print("invariant missing id")
        elif n > 1:
            print(f"duplicate invariant id: {inv_id}")
    supported = set(re.findall(r'"([a-z_]+)":\s*_check_', dispatch.read_text(encoding="utf-8")))
    documented = set((data.get("_types") or {}).keys())
    used = {i.get("type") for i in invs}
    for t in sorted(used - supported):
        print(f"invariant type used but unsupported: {t}")
    for t in sorted(used - documented):
        print(f"invariant type used but undocumented: {t}")
    for t in sorted(documented - supported):
        print(f"invariant type documented but unsupported: {t}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
