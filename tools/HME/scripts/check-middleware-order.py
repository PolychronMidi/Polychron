#!/usr/bin/env python3
"""Lint: every middleware file in tools/HME/proxy/middleware/ (except
index.js, _-prefixed utilities, and tests) MUST have a NN_ or NNa_ prefix
encoding load order. Unprefixed files load alphabetically AFTER prefixed
ones, which can break dependency chains.

Exit 0 clean, 1 on drift. Intended for CI / pre-commit.
"""
from __future__ import annotations

import os
import re
import sys


_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_MW_DIR = os.path.join(_PROJECT_ROOT, "tools", "HME", "proxy", "middleware")
_PREFIX_RE = re.compile(r"^\d+[a-z]?_")


def main() -> int:
    if not os.path.isdir(_MW_DIR):
        print(f"check-middleware-order: middleware dir not found: {_MW_DIR}")
        return 0
    middleware_files = [
        f for f in os.listdir(_MW_DIR)
        if f.endswith(".js")
        and f != "index.js"
        and not f.startswith("_")
        and not f.startswith("test_")
        and not f.endswith(".test.js")
    ]
    unprefixed = [f for f in middleware_files if not _PREFIX_RE.match(f)]
    if unprefixed:
        print("FAIL: middleware files lacking NN_ numeric prefix:")
        for f in sorted(unprefixed):
            print(f"  - {f}")
        return 1
    prefixes = {}
    for f in middleware_files:
        m = _PREFIX_RE.match(f)
        if not m:
            continue
        key = m.group(0).rstrip("_")
        prefixes.setdefault(key, []).append(f)
    duplicates = {n: fs for n, fs in prefixes.items() if len(fs) > 1}
    if duplicates:
        print("FAIL: duplicate numeric prefixes:")
        for n, fs in sorted(duplicates.items()):
            print(f"  {n:02d}: {', '.join(sorted(fs))}")
        return 1
    print(f"check-middleware-order: PASS ({len(middleware_files)} prefixed, no duplicates)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
