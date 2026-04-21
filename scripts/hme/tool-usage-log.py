#!/usr/bin/env python3
"""Append one row per i/* tool invocation to metrics/hme-tool-usage.jsonl.

Called by i/ wrappers as a side effect. Over time this produces the Arc IV
equivalent for tools — which `i/` commands get used, which are decorative.
"""
from __future__ import annotations
import json
import os
import sys
import time

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOG = os.path.join(PROJECT_ROOT, "metrics", "hme-tool-usage.jsonl")


def main(argv):
    if len(argv) < 2:
        return 0
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        rec = {
            "ts": int(time.time()),
            "tool": argv[1],
            "args": argv[2:8],  # cap to avoid huge payloads
        }
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
