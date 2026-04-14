#!/usr/bin/env python3
"""H17: Agent 'forget' slot — let the agent curate its own working memory.

An agent accumulates context across a turn. Some of that context is
dead-end reasoning, failed search attempts, or speculative hypotheses
that turned out to be wrong. Keeping this in context bloats the window
and biases future responses toward the bad path.

This script exposes a file-based primitive: agents can append a line to
tmp/hme-forget-queue.txt describing what they want to "forget". The
PreCompact hook reads the queue and prioritizes dropping those items
from context during compaction. The PostCompact hook clears the queue.

Agents can also read the queue to see what they previously declared
dead (preventing re-exploration of the same dead ends).

This is a lightweight version of persistent agent memory curation. A
future extension could wire it directly into Claude Code's compaction
API if one becomes available.

Usage:
    python3 tools/HME/scripts/hme-forget.py --add "searched crossLayerFake123 — does not exist"
    python3 tools/HME/scripts/hme-forget.py --list
    python3 tools/HME/scripts/hme-forget.py --clear
"""
import os
import sys
import time

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_QUEUE = os.path.join(_PROJECT, "tmp", "hme-forget-queue.txt")


def add(text: str) -> int:
    os.makedirs(os.path.dirname(_QUEUE), exist_ok=True)
    with open(_QUEUE, "a") as f:
        f.write(f"{int(time.time())}\t{text}\n")
    print(f"queued: {text}")
    return 0


def list_queue() -> int:
    if not os.path.isfile(_QUEUE):
        print("[empty — nothing queued to forget]")
        return 0
    try:
        with open(_QUEUE) as f:
            lines = f.readlines()
    except Exception as e:
        sys.stderr.write(f"read error: {e}\n")
        return 2
    if not lines:
        print("[empty]")
        return 0
    for line in lines:
        parts = line.rstrip().split("\t", 1)
        if len(parts) == 2:
            ts, text = parts
            try:
                ts_str = time.strftime("%H:%M:%S", time.localtime(int(ts)))
            except Exception:
                ts_str = "?"
            print(f"  [{ts_str}] {text}")
    return 0


def clear() -> int:
    try:
        os.remove(_QUEUE)
        print("forget queue cleared")
    except FileNotFoundError:
        print("[already empty]")
    except Exception as e:
        sys.stderr.write(f"clear error: {e}\n")
        return 2
    return 0


def main(argv: list) -> int:
    if "--add" in argv:
        idx = argv.index("--add")
        if idx + 1 >= len(argv):
            sys.stderr.write("--add requires a string argument\n")
            return 2
        return add(argv[idx + 1])
    if "--list" in argv:
        return list_queue()
    if "--clear" in argv:
        return clear()
    sys.stderr.write("usage: --add TEXT | --list | --clear\n")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
