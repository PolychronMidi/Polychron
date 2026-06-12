#!/usr/bin/env python3
"""Emit bash code that declares + parses + persists every detector verdict
described in registry.json. detectors.sh sources `eval "$(emit_detectors_sh.py)"`
to mechanize what was previously a 3-place manual sync (init line, parse case,
persist echo). The COMMENT_BLOAT silent-disable bug -- python verdict computed
but never written to disk because the persist echo was missed -- is structurally
prevented now: every registered bash_var gets all 3 lines emitted in lockstep.
"""
from __future__ import annotations

import json
import os
import sys


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "registry.json")) as f:
        reg = json.load(f)
    bash_vars = []
    seen = set()
    for d in reg["detectors"]:
        if d["bash_var"] in seen:
            continue
        seen.add(d["bash_var"])
        bash_vars.append((d["bash_var"], d.get("module") or d["bash_var"].lower()))
    print("# === GENERATED FROM registry.json by emit_detectors_sh.py ===")
    print("# Adding a detector = add to registry.json; this block updates automatically.")
    # INIT block.
    for bv, _ in bash_vars:
        # poll_count starts as 0 (numeric); everything else as 'ok'.
        default = "0" if bv == "POLL_COUNT" else "ok"
        print(f"{bv}={default}")
    # PARSE case (emitted as a function caller can include inside a `case "$_k" in`).
    print("_detector_parse_case() {")
    print('  case "$1" in')
    for bv, _ in bash_vars:
        lower = bv.lower()
        print(f'    {lower}) {bv}="$2" ;;')
    print("  esac")
    print("}")
    # PERSIST block (emit lines for each var).
    print("_detector_emit_persist() {")
    for bv, _ in bash_vars:
        print(f'  echo "{bv}=${bv}"')
    print("}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
