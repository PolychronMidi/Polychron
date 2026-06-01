#!/usr/bin/env python3
"""Manage HME model route health overrides."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
HEALTH_PATH = ROOT / "tools" / "HME" / "runtime" / "model-route-health.json"


def load_health(path: Path = HEALTH_PATH) -> dict[str, Any]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def write_health(data: dict[str, Any], path: Path = HEALTH_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def iso_after(seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def set_route(args: argparse.Namespace) -> int:
    data = load_health(args.file)
    entry: dict[str, Any] = {"status": args.status}
    if args.reason:
        entry["reason"] = args.reason
    if args.until:
        entry["until"] = args.until
    if args.ttl_seconds is not None:
        entry["until"] = iso_after(args.ttl_seconds)
    data[args.route] = entry
    write_health(data, args.file)
    print(f"route_health=set {args.route} {args.status}")
    return 0


def clear_route(args: argparse.Namespace) -> int:
    data = load_health(args.file)
    removed = data.pop(args.route, None) is not None
    write_health(data, args.file)
    print(f"route_health={'cleared' if removed else 'absent'} {args.route}")
    return 0


def list_routes(args: argparse.Namespace) -> int:
    print(json.dumps(load_health(args.file), indent=2, sort_keys=True))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", type=Path, default=HEALTH_PATH)
    sub = ap.add_subparsers(required=True)

    setp = sub.add_parser("set")
    setp.add_argument("route", help="provider/model route key")
    setp.add_argument("status", choices=["cooldown", "blocked", "unavailable", "disabled", "ok"])
    setp.add_argument("--reason", default="")
    setp.add_argument("--until", default="")
    setp.add_argument("--ttl-seconds", type=int)
    setp.set_defaults(func=set_route)

    clearp = sub.add_parser("clear")
    clearp.add_argument("route")
    clearp.set_defaults(func=clear_route)

    listp = sub.add_parser("list")
    listp.set_defaults(func=list_routes)
    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
