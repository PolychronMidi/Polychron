#!/usr/bin/env python3
"""Lint rule: every .js file in tools/HME/proxy/middleware/ (excluding
index.js) MUST be listed in order.json, and every entry in order.json
MUST correspond to an existing file.

Without this, new middleware gets silently appended in alphabetical
fallback position — which may break a dependency chain (lifesaver_inject
must run before proxy_autocommit). The dogfooding probe inside selftest
warns; this lint rule hard-fails so a commit introducing drift is caught.

Exit 0 clean, 1 on drift. Intended for CI / pre-commit.
"""
from __future__ import annotations

import json
import os
import sys


_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_MW_DIR = os.path.join(_PROJECT_ROOT, "tools", "HME", "proxy", "middleware")
_ORDER_PATH = os.path.join(_MW_DIR, "order.json")


def main() -> int:
    if not os.path.isdir(_MW_DIR):
        print(f"check-middleware-order: middleware dir not found: {_MW_DIR}")
        return 0  # not fatal — repo may be stripped
    if not os.path.isfile(_ORDER_PATH):
        print(f"FAIL: middleware/order.json missing. Create it to declare explicit load order.")
        return 1
    try:
        with open(_ORDER_PATH, encoding="utf-8") as f:
            doc = json.load(f)
    except Exception as e:
        print(f"FAIL: order.json is not valid JSON: {type(e).__name__}: {e}")
        return 1
    manifest = doc.get("order", [])
    if not isinstance(manifest, list):
        print("FAIL: order.json `order` must be a list of filenames")
        return 1
    present = sorted(
        f for f in os.listdir(_MW_DIR)
        if f.endswith(".js") and f not in ("index.js",)
    )
    unlisted = [f for f in present if f not in manifest]
    stale = [f for f in manifest if f not in present]
    issues = []
    if unlisted:
        issues.append(
            f"{len(unlisted)} file(s) present but not in order.json: {unlisted} "
            f"— they load alphabetically AFTER the manifest, potentially breaking dependencies"
        )
    if stale:
        issues.append(
            f"{len(stale)} entry/entries in order.json reference absent file(s): {stale}"
        )
    if issues:
        print("check-middleware-order: drift detected:")
        for i in issues:
            print(f"  - {i}")
        print()
        print(f"Fix: edit {os.path.relpath(_ORDER_PATH, _PROJECT_ROOT)} to add unlisted "
              f"files at the right position, or remove stale entries.")
        return 1
    print(f"check-middleware-order: CLEAN — {len(manifest)}/{len(present)} files declared in order.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
