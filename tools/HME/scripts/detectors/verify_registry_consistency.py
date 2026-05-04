#!/usr/bin/env python3
"""Lint-time verifier: detectors.sh wiring matches registry.json.

The bug this prevents: COMMENT_BLOAT was added to registry + run_all + the
case-statement parser of detectors.sh, but the corresponding
`echo "COMMENT_BLOAT=$COMMENT_BLOAT"` in the persistence block was missed.
The python verdict was parsed into the bash variable but never written to
disk, so work_checks.js read no value and never denied. Silent gate.

This verifier reads registry.json and asserts detectors.sh contains, for
every unique bash_var:
  1. INIT line (`<VAR>=ok` or `<VAR>=0` for poll_count)
  2. PARSE case (`<lower>) <VAR>="$_v" ;;`)
  3. PERSIST echo (`echo "<VAR>=$<VAR>"`)

Exit 0 = clean. Exit 1 = drift, prints which bash_vars are missing which
of init/parse/persist.
"""
from __future__ import annotations

import json
import os
import re
import sys


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    project = os.environ.get("PROJECT_ROOT") or os.path.abspath(os.path.join(here, "..", "..", "..", ".."))
    reg_path = os.path.join(here, "registry.json")
    sh_path = os.path.join(project, "tools", "HME", "hooks", "lifecycle", "stop", "detectors.sh")
    with open(reg_path) as f:
        reg = json.load(f)
    with open(sh_path) as f:
        sh = f.read()
    bash_vars = sorted({d["bash_var"] for d in reg["detectors"]})
    missing = []
    for bv in bash_vars:
        lower = bv.lower()
        init_re = re.compile(rf"^{re.escape(bv)}=(?:ok|0)\b", re.MULTILINE)
        parse_re = re.compile(rf"\b{re.escape(lower)}\)\s*{re.escape(bv)}=", re.MULTILINE)
        persist_re = re.compile(rf'echo\s+"{re.escape(bv)}=\${re.escape(bv)}"', re.MULTILINE)
        gaps = []
        if not init_re.search(sh): gaps.append("INIT")
        if not parse_re.search(sh): gaps.append("PARSE")
        if not persist_re.search(sh): gaps.append("PERSIST")
        if gaps:
            missing.append((bv, gaps))
    if missing:
        print("REGISTRY DRIFT in detectors.sh:")
        for bv, gaps in missing:
            print(f"  {bv}: missing {', '.join(gaps)}")
        print(f"\nFix: add the missing line(s) to {sh_path}")
        return 1
    print(f"detectors.sh: all {len(bash_vars)} bash_vars correctly wired (init+parse+persist)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
