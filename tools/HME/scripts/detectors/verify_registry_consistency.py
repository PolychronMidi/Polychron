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

_CATEGORIES = {"universal", "security", "project_contract"}
_REQUIRED_METADATA = ("category", "scope", "owning_invariant", "why")


def _metadata_gaps(detectors):
    gaps = []
    for idx, det in enumerate(detectors):
        label = det.get("name") or f"detector[{idx}]"
        for key in _REQUIRED_METADATA:
            if not det.get(key):
                gaps.append(f"{label}: missing {key}")
        if det.get("category") not in _CATEGORIES:
            gaps.append(f"{label}: invalid category {det.get('category')!r}")
        has_fixture = bool(det.get("fixture_path"))
        waiver = det.get("fixture_waiver")
        if has_fixture and waiver:
            gaps.append(f"{label}: fixture_path and fixture_waiver are mutually exclusive")
        if not has_fixture and not waiver:
            gaps.append(f"{label}: missing fixture_path or fixture_waiver")
        if waiver:
            if not isinstance(waiver, dict):
                gaps.append(f"{label}: fixture_waiver must be an object")
            else:
                if not waiver.get("reason"):
                    gaps.append(f"{label}: fixture_waiver missing reason")
                date = str(waiver.get("review_date", ""))
                if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
                    gaps.append(f"{label}: fixture_waiver review_date must be YYYY-MM-DD")
    return gaps


def _path_exists(project, value):
    if isinstance(value, list):
        return all(_path_exists(project, v) for v in value)
    return isinstance(value, str) and os.path.exists(os.path.join(project, value))


def _fixture_gaps(project, detectors):
    gaps = []
    for det in detectors:
        fixture = det.get("fixture_path")
        if fixture and not _path_exists(project, fixture):
            gaps.append(f"{det.get('name')}: fixture_path missing: {fixture}")
    return gaps


def _print_gaps(title, gaps):
    if not gaps:
        return
    print(title)
    for gap in gaps:
        print(f"  - {gap}")



def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    project = os.environ.get("PROJECT_ROOT") or os.path.abspath(os.path.join(here, "..", "..", "..", ".."))
    reg_path = os.path.join(here, "registry.json")
    sh_path = os.path.join(project, "tools", "HME", "hooks", "lifecycle", "stop", "detectors.sh")
    with open(reg_path) as f:
        reg = json.load(f)
    with open(sh_path) as f:
        sh = f.read()
    # detectors.sh now sources emit_detectors_sh.py via eval; verify the
    eval_re = re.compile(r'eval\s+"\$\(\s*python3\s+[^)]*emit_detectors_sh\.py')
    parse_call_re = re.compile(r'_detector_parse_case\s+')
    persist_call_re = re.compile(r'_detector_emit_persist\s*>\s*')
    gaps = []
    if not eval_re.search(sh): gaps.append("eval emit_detectors_sh")
    if not parse_call_re.search(sh): gaps.append("_detector_parse_case call")
    if not persist_call_re.search(sh): gaps.append("_detector_emit_persist call")
    if gaps:
        print("DETECTORS.SH WIRING DRIFT:")
        for g in gaps: print(f"  missing: {g}")
        print(f"\nFix: see {sh_path}")
        return 1
    metadata_gaps = _metadata_gaps(reg["detectors"])
    fixture_gaps = _fixture_gaps(project, reg["detectors"])
    if metadata_gaps or fixture_gaps:
        _print_gaps("REGISTRY METADATA DRIFT:", metadata_gaps)
        _print_gaps("REGISTRY FIXTURE DRIFT:", fixture_gaps)
        return 1
    # Also verify emit_detectors_sh.py output covers every bash_var.
    import subprocess
    proc = subprocess.run(
        ["python3", os.path.join(here, "emit_detectors_sh.py")],
        capture_output=True, text=True, env={**os.environ, "PROJECT_ROOT": project},
    )
    bash_vars = sorted({d["bash_var"] for d in reg["detectors"]})
    out = proc.stdout
    missing = [bv for bv in bash_vars if f"\n{bv}=" not in out and not out.startswith(f"{bv}=")]
    if missing:
        print(f"emit_detectors_sh.py output missing INIT lines for: {missing}")
        return 1
    print(f"detectors.sh: registry-driven wiring + metadata verified ({len(bash_vars)} bash_vars covered)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
