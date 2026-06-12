#!/usr/bin/env python3
"""Validate typed shortcut/route causal-path metadata."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[4])
CONFIG = ROOT / "tools/HME/config/causal-paths.json"
SHORTCUTS = ROOT / "tools/HME/config/shortcuts.json"
REQUIRED = {"intent", "lane", "allowed_emitter", "forbidden_emitters", "proof_id_shape", "negative_controls"}
# Optional fields a row MAY carry beyond REQUIRED (host-execution provenance for
# lanes whose final step depends on host/client behavior outside proxy control).
OPTIONAL = {"host_execution_status", "host_execution_evidence"}
VALID_LANES = {"wire", "local-session", "host-task-notification"}
VALID_HOST_EXEC = {"executed", "blocked-host-side", "not-applicable"}


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _nonempty_str(v) -> bool:
    return isinstance(v, str) and bool(v.strip())


def _list(v) -> bool:
    return isinstance(v, list) and bool(v) and all(_nonempty_str(x) for x in v)


def main() -> int:
    findings: list[str] = []
    cfg = _load(CONFIG)
    shortcuts = _load(SHORTCUTS)
    paths = cfg.get("paths") if isinstance(cfg, dict) else None
    if cfg.get("schema") != 1:
        findings.append("causal-paths schema must be 1")
    if not isinstance(paths, dict) or not paths:
        findings.append("causal-paths paths must be nonempty object")
        paths = {}
    for key, row in sorted(paths.items()):
        if not isinstance(row, dict):
            findings.append(f"{key}: row must be object")
            continue
        missing = sorted(REQUIRED - set(row))
        extra = sorted(set(row) - REQUIRED - OPTIONAL)
        if missing:
            findings.append(f"{key}: missing {', '.join(missing)}")
        hes = row.get("host_execution_status")
        if hes is not None:
            if hes not in VALID_HOST_EXEC:
                findings.append(f"{key}: invalid host_execution_status {hes!r}")
            if not _nonempty_str(row.get("host_execution_evidence")):
                findings.append(f"{key}: host_execution_status requires nonempty host_execution_evidence")
        if extra:
            findings.append(f"{key}: extra {', '.join(extra)}")
        for field in ("intent", "allowed_emitter", "proof_id_shape"):
            if not _nonempty_str(row.get(field)):
                findings.append(f"{key}: {field} must be nonempty string")
        if row.get("lane") not in VALID_LANES:
            findings.append(f"{key}: invalid lane {row.get('lane')!r}")
        for field in ("forbidden_emitters", "negative_controls"):
            if not _list(row.get(field)):
                findings.append(f"{key}: {field} must be nonempty string list")
    if "shortcut.rr" not in paths:
        findings.append("missing causal path shortcut.rr")
    elif shortcuts.get("simple", {}).get("rr") != "[HME_READ_CHAIN] README.md; package.json":
        findings.append("shortcut.rr must be a wire simple shortcut expanding to [HME_READ_CHAIN]")
    if "shortcut.cc" not in paths:
        findings.append("missing causal path shortcut.cc")
    elif "cc" not in shortcuts.get("multi-step", {}):
        findings.append("shortcut.cc must be local-session multi-step")
    if "readq" in shortcuts.get("multi-step", {}):
        findings.append("retired readq shortcut must not exist")
    for key, spec in (shortcuts.get("multi-step") or {}).items():
        for step in spec.get("steps") or []:
            if "[HME_READ_CHAIN]" in str(step):
                findings.append(f"{key}: local-session step must not type [HME_READ_CHAIN]")
    if "consult.task-notification-read-chain" not in paths:
        findings.append("missing consult.task-notification-read-chain causal path")
    for row in findings:
        print(row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
