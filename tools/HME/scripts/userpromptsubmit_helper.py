"""Helper actions for UserPromptSubmit lifecycle hook.

Shell hooks should orchestrate, not embed Python heredocs. This module owns the
small Python-only operations previously inlined in userpromptsubmit.sh.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def capture_correction(path: str, prompt: str) -> int:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "ts": int(time.time()),
        "ts_human": time.strftime("%Y-%m-%d %H:%M:%S"),
        "prompt_preview": prompt[:500],
    }
    with target.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    return 0


def supervisor_child(path: str) -> int:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return 1
    child = data.get("child", "") if isinstance(data, dict) else ""
    if child:
        print(child)
    return 0


def critical_todos() -> int:
    # Import lazily so other helper modes do not pay service import cost.
    from server.tools_analysis.todo import list_critical

    items = list_critical()
    if items:
        print("HME CRITICAL TODOS (unresolved):")
        for item in items:
            source = item.get("source") if isinstance(item, dict) else ""
            src = f" [{source}]" if source else ""
            print(f"  !!! #{item['id']} {item['text']}{src}")
    return 0


def last_ground_truth(path: str) -> int:
    target = Path(path)
    if not target.is_file():
        return 0
    last = ""
    try:
        with target.open("r", encoding="utf-8", errors="replace") as f:
            for raw in f:
                raw = raw.strip()
                if raw:
                    last = raw
    except OSError:
        return 0
    if not last:
        return 0
    try:
        data = json.loads(last)
    except json.JSONDecodeError:
        return 0
    tags = data.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    print(f"{data.get('sha')}|{','.join(str(t) for t in tags)}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="UserPromptSubmit helper actions")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("capture-correction")
    p.add_argument("path")
    p.add_argument("prompt")

    p = sub.add_parser("supervisor-child")
    p.add_argument("path")

    sub.add_parser("critical-todos")

    p = sub.add_parser("last-ground-truth")
    p.add_argument("path")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd == "capture-correction":
        return capture_correction(args.path, args.prompt)
    if args.cmd == "supervisor-child":
        return supervisor_child(args.path)
    if args.cmd == "critical-todos":
        return critical_todos()
    if args.cmd == "last-ground-truth":
        return last_ground_truth(args.path)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
